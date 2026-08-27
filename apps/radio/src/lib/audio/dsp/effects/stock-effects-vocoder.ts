import { BiquadFilter } from "./biquad-filter.js";
import { clamp, dbToGain } from "./stock-effect-utils.js";
import type { StereoChannels } from "./types.js";

export class VocoderEffect {
  private readonly sampleRate: number;
  private bands = 12;
  private modulator: "self" | "noise" | "external" = "self";
  private release = 80;
  private carrierGain = 1;
  private modulatorGain = 1;
  private noise = 0.3;
  private noiseKind: "white" | "pink" | "brown" = "white";
  private pinkNoise = 0;
  private brownNoise = 0;
  private carrierMinFreq = 100;
  private carrierMaxFreq = 8000;
  private modulatorMinFreq = 100;
  private modulatorMaxFreq = 8000;
  private qStart = 3;
  private qEnd = 3;
  private attack = 5;
  private gain = 1;
  private mix = 1;
  private sidechain: StereoChannels | null = null;
  private carrierFilters: BiquadFilter[] = [];
  private modulatorFilters: BiquadFilter[] = [];
  private envelopes: number[] = [];
  private readonly carrierL = new Float32Array(128);
  private readonly carrierR = new Float32Array(128);
  private readonly carrierChannels: StereoChannels = [
    this.carrierL,
    this.carrierR,
  ];
  private readonly modL = new Float32Array(128);
  private readonly modR = new Float32Array(128);
  private readonly modChannels: StereoChannels = [this.modL, this.modR];
  private noiseState = 0x12_34_ab_cd;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.rebuildBands();
  }

  setBands(value: number): void {
    let next = 16;
    if (value <= 8) {
      next = 8;
    } else if (value <= 12) {
      next = 12;
    }
    if (next !== this.bands) {
      this.bands = next;
      this.rebuildBands();
    }
  }

  setModulator(value: string): void {
    if (value === "self" || value === "noise" || value === "external") {
      this.modulator = value;
    }
  }

  setModulatorSource(value: string): void {
    if (value === "self" || value === "external") {
      this.modulator = value;
      return;
    }
    if (value.startsWith("noise-")) {
      this.modulator = "noise";
      const noiseKind = value.slice("noise-".length);
      if (
        noiseKind === "white" ||
        noiseKind === "pink" ||
        noiseKind === "brown"
      ) {
        this.noiseKind = noiseKind;
      }
    }
  }

  setCarrierMinFreq(value: number): void {
    const next = clamp(value, 20, this.sampleRate / 2 - 1);
    if (next === this.carrierMinFreq) {
      return;
    }
    this.carrierMinFreq = next;
    this.rebuildBands();
  }

  setCarrierMaxFreq(value: number): void {
    const next = clamp(value, 20, this.sampleRate / 2 - 1);
    if (next === this.carrierMaxFreq) {
      return;
    }
    this.carrierMaxFreq = next;
    this.rebuildBands();
  }

  setModulatorMinFreq(value: number): void {
    const next = clamp(value, 20, this.sampleRate / 2 - 1);
    if (next === this.modulatorMinFreq) {
      return;
    }
    this.modulatorMinFreq = next;
    this.rebuildBands();
  }

  setModulatorMaxFreq(value: number): void {
    const next = clamp(value, 20, this.sampleRate / 2 - 1);
    if (next === this.modulatorMaxFreq) {
      return;
    }
    this.modulatorMaxFreq = next;
    this.rebuildBands();
  }

  setQStart(value: number): void {
    const next = clamp(value, 1, 60);
    if (next === this.qStart) {
      return;
    }
    this.qStart = next;
    this.rebuildBands();
  }

  setQEnd(value: number): void {
    const next = clamp(value, 1, 60);
    if (next === this.qEnd) {
      return;
    }
    this.qEnd = next;
    this.rebuildBands();
  }

  setAttack(value: number): void {
    this.attack = clamp(value, 0.1, 100);
  }

  setRelease(value: number): void {
    this.release = clamp(value, 5, 1000);
  }

  setCarrierGain(value: number): void {
    this.carrierGain = clamp(value, 0, 4);
  }

  setModulatorGain(value: number): void {
    this.modulatorGain = clamp(value, 0, 4);
  }

  setNoise(value: number): void {
    this.noise = clamp(value, 0, 1);
  }

  setGain(value: number): void {
    this.gain = dbToGain(clamp(value, -20, 20));
  }

  setMix(value: number): void {
    this.mix = clamp(value, 0, 1);
  }

  setSidechainInput(input: StereoChannels | null): void {
    this.sidechain = input;
  }

  private rebuildBands(): void {
    const makeFilters = (minimum: number, maximum: number): BiquadFilter[] =>
      Array.from({ length: this.bands }, (_, index) => {
        const filter = new BiquadFilter(this.sampleRate);
        filter.type = "bandpass";
        const position = index / Math.max(1, this.bands - 1);
        const low = Math.min(minimum, maximum);
        const high = Math.max(minimum, maximum);
        filter.frequency = low * (high / low) ** position;
        filter.Q = this.qStart + (this.qEnd - this.qStart) * position;
        return filter;
      });
    this.carrierFilters = makeFilters(this.carrierMinFreq, this.carrierMaxFreq);
    this.modulatorFilters = makeFilters(
      this.modulatorMinFreq,
      this.modulatorMaxFreq
    );
    this.envelopes = Array.from({ length: this.bands }, () => 0);
  }

  reset(): void {
    for (const filter of [...this.carrierFilters, ...this.modulatorFilters]) {
      filter.reset();
    }
    this.envelopes.fill(0);
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    const modulator =
      this.modulator === "external" && this.sidechain ? this.sidechain : input;
    output[0].fill(0, fromIndex, toIndex);
    output[1].fill(0, fromIndex, toIndex);
    const releaseCoeff = Math.exp(
      -1 / (this.sampleRate * this.release * 0.001)
    );
    const attackCoeff = Math.exp(-1 / (this.sampleRate * this.attack * 0.001));
    for (let band = 0; band < this.bands; band++) {
      const carrierFilter = this.carrierFilters[band];
      const modulatorFilter = this.modulatorFilters[band];
      if (!(carrierFilter && modulatorFilter)) {
        continue;
      }
      if (this.modulator === "noise") {
        for (let i = fromIndex; i < toIndex; i++) {
          this.noiseState ^= this.noiseState << 13;
          this.noiseState ^= this.noiseState >>> 17;
          this.noiseState ^= this.noiseState << 5;
          const white = (this.noiseState / 0x7f_ff_ff_ff) * this.noise;
          this.pinkNoise = this.pinkNoise * 0.98 + white * 0.02;
          this.brownNoise = clamp(this.brownNoise + white * 0.02, -1, 1);
          let noise = white;
          if (this.noiseKind === "pink") {
            noise = this.pinkNoise * 5;
          } else if (this.noiseKind === "brown") {
            noise = this.brownNoise;
          }
          this.modL[i] = noise;
          this.modR[i] = noise;
        }
        modulatorFilter.process(
          this.modChannels,
          this.modChannels,
          fromIndex,
          toIndex
        );
      } else {
        modulatorFilter.process(
          modulator,
          this.modChannels,
          fromIndex,
          toIndex
        );
      }
      carrierFilter.process(input, this.carrierChannels, fromIndex, toIndex);
      let envelope = this.envelopes[band] ?? 0;
      for (let i = fromIndex; i < toIndex; i++) {
        const detected =
          Math.max(Math.abs(this.modL[i] ?? 0), Math.abs(this.modR[i] ?? 0)) *
          this.modulatorGain;
        const envelopeCoeff = detected > envelope ? attackCoeff : releaseCoeff;
        envelope = detected + envelopeCoeff * (envelope - detected);
        output[0][i] =
          (output[0][i] ?? 0) +
          (this.carrierL[i] ?? 0) * envelope * this.carrierGain;
        output[1][i] =
          (output[1][i] ?? 0) +
          (this.carrierR[i] ?? 0) * envelope * this.carrierGain;
      }
      this.envelopes[band] = envelope;
    }
    const gain = 2 / Math.sqrt(this.bands);
    for (let i = fromIndex; i < toIndex; i++) {
      output[0][i] =
        (input[0][i] ?? 0) * (1 - this.mix) +
        (output[0][i] ?? 0) * gain * this.gain * this.mix;
      output[1][i] =
        (input[1][i] ?? 0) * (1 - this.mix) +
        (output[1][i] ?? 0) * gain * this.gain * this.mix;
    }
  }
}
