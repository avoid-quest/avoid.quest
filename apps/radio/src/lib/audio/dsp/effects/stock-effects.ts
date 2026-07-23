import { BiquadFilter } from "./biquad-filter.js";
import { PhaseVocoder } from "./phase-vocoder.js";
import type { StereoChannels } from "./types.js";

const dbToGain = (value: number): number => 10 ** (value / 20);
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
const WERKSTATT_RETURN_PREFIX = /^return\s+/;
const WERKSTATT_TRAILING_SEMICOLON = /;\s*$/;
const WERKSTATT_FORBIDDEN_SOURCE =
  /(?:\b(?:for|while|do|function|class|new|this|globalThis|self|constructor|prototype|import|eval)\b|[[\]{}"'`;])/;
const WERKSTATT_IDENTIFIER = /[A-Za-z_$][\w$]*/g;

export class CheapReverbEffect {
  private readonly delays: Float32Array[];
  private readonly indices: number[];
  private readonly preDelayL: Float32Array;
  private readonly preDelayR: Float32Array;
  private preDelayIndex = 0;
  private preDelaySamples = 0;
  private roomSize = 0.72;
  private damping = 0.35;
  private width = 1;
  private filter = 0;
  private dry = 0;
  private wet = 1;
  private filteredL = 0;
  private filteredR = 0;
  private readonly dampState = [0, 0, 0, 0];

  constructor(sampleRate: number) {
    this.delays = [0.0297, 0.0371, 0.0411, 0.0437].map(
      (seconds) =>
        new Float32Array(Math.max(1, Math.round(seconds * sampleRate)))
    );
    this.indices = this.delays.map(() => 0);
    this.preDelayL = new Float32Array(Math.ceil(sampleRate * 0.5) + 1);
    this.preDelayR = new Float32Array(this.preDelayL.length);
  }

  setRoomSize(value: number): void {
    this.roomSize = clamp(value, 0, 0.98);
  }

  setDamping(value: number): void {
    this.damping = clamp(value, 0, 0.99);
  }

  setWidth(value: number): void {
    this.width = clamp(value, 0, 1);
  }

  setDecay(value: number): void {
    this.setRoomSize(value);
  }

  setPreDelay(value: number): void {
    this.preDelaySamples = Math.round(
      clamp(value, 0, 0.5) * (this.preDelayL.length - 1) * 2
    );
  }

  setDamp(value: number): void {
    this.setDamping(value);
  }

  setFilter(value: number): void {
    this.filter = clamp(value, -1, 1);
  }

  setDry(value: number): void {
    this.dry = dbToGain(value);
  }

  setWet(value: number): void {
    this.wet = dbToGain(value);
  }

  reset(): void {
    for (const delay of this.delays) {
      delay.fill(0);
    }
    this.indices.fill(0);
    this.dampState.fill(0);
    this.preDelayL.fill(0);
    this.preDelayR.fill(0);
    this.preDelayIndex = 0;
    this.filteredL = 0;
    this.filteredR = 0;
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;
    for (let i = fromIndex; i < toIndex; i++) {
      const inputSampleL = inputL[i] ?? 0;
      const inputSampleR = inputR[i] ?? 0;
      this.preDelayL[this.preDelayIndex] = inputSampleL;
      this.preDelayR[this.preDelayIndex] = inputSampleR;
      const readIndex =
        (this.preDelayIndex -
          Math.min(this.preDelaySamples, this.preDelayL.length - 1) +
          this.preDelayL.length) %
        this.preDelayL.length;
      const mono =
        ((this.preDelayL[readIndex] ?? 0) + (this.preDelayR[readIndex] ?? 0)) *
        0.5;
      this.preDelayIndex = (this.preDelayIndex + 1) % this.preDelayL.length;
      let even = 0;
      let odd = 0;
      for (let line = 0; line < this.delays.length; line++) {
        const delay = this.delays[line];
        const index = this.indices[line] ?? 0;
        const delayed = delay?.[index] ?? 0;
        const damped =
          delayed * (1 - this.damping) +
          (this.dampState[line] ?? 0) * this.damping;
        this.dampState[line] = damped;
        if (delay) {
          delay[index] = mono + damped * this.roomSize;
          this.indices[line] = (index + 1) % delay.length;
        }
        if (line % 2 === 0) {
          even += delayed;
        } else {
          odd += delayed;
        }
      }
      const mid = (even + odd) * 0.25;
      const side = (even - odd) * 0.25 * this.width;
      const filterCoefficient = 0.02 + (this.filter + 1) * 0.5 * 0.96;
      this.filteredL += (mid + side - this.filteredL) * filterCoefficient;
      this.filteredR += (mid - side - this.filteredR) * filterCoefficient;
      outputL[i] = inputSampleL * this.dry + this.filteredL * this.wet;
      outputR[i] = inputSampleR * this.dry + this.filteredR * this.wet;
    }
  }
}

export class GateEffect {
  private readonly sampleRate: number;
  private threshold = -36;
  private attack = 5;
  private release = 120;
  private hold = 20;
  private floor = -80;
  private returnAmount = 0;
  private inverse = false;
  private envelope = 0;
  private gain = 0;
  private holdSamples = 0;
  private sidechain: StereoChannels | null = null;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  setThreshold(value: number): void {
    this.threshold = clamp(value, -80, 0);
  }

  setAttack(value: number): void {
    this.attack = clamp(value, 0.1, 500);
  }

  setRelease(value: number): void {
    this.release = clamp(value, 1, 5000);
  }

  setHold(value: number): void {
    this.hold = clamp(value, 0, 2000);
  }

  setFloor(value: number): void {
    this.floor = clamp(value, -120, 0);
  }

  setInverse(value: boolean): void {
    this.inverse = value;
  }

  setReturn(value: number): void {
    this.returnAmount = clamp(value, 0, 24);
  }

  setSidechainInput(input: StereoChannels | null): void {
    this.sidechain = input;
  }

  reset(): void {
    this.envelope = 0;
    this.gain = 0;
    this.holdSamples = 0;
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    const detector = this.sidechain ?? input;
    const threshold = dbToGain(this.threshold);
    const floor = dbToGain(this.floor);
    const attackCoeff = Math.exp(-1 / (this.sampleRate * this.attack * 0.001));
    const releaseCoeff = Math.exp(
      -1 / (this.sampleRate * this.release * 0.001)
    );
    const maxHold = Math.round(this.sampleRate * this.hold * 0.001);
    for (let i = fromIndex; i < toIndex; i++) {
      const level = Math.max(
        Math.abs(detector[0][i] ?? 0),
        Math.abs(detector[1][i] ?? 0)
      );
      const envelopeCoeff = level > this.envelope ? attackCoeff : releaseCoeff;
      this.envelope = level + envelopeCoeff * (this.envelope - level);
      const closeThreshold = dbToGain(this.threshold - this.returnAmount);
      if (this.envelope >= threshold) {
        this.holdSamples = maxHold;
      } else if (this.holdSamples > 0) {
        this.holdSamples--;
      }
      const open =
        this.envelope >= (this.gain > floor ? closeThreshold : threshold) ||
        this.holdSamples > 0;
      const target = (this.inverse ? !open : open) ? 1 : floor;
      const gainCoeff = target > this.gain ? attackCoeff : releaseCoeff;
      this.gain = target + gainCoeff * (this.gain - target);
      output[0][i] = (input[0][i] ?? 0) * this.gain;
      output[1][i] = (input[1][i] ?? 0) * this.gain;
    }
  }
}

export type WaveshaperShape =
  | "hardclip"
  | "cubic"
  | "tanh"
  | "sigmoid"
  | "arctan"
  | "asymmetric";

export class WaveshaperEffect {
  private shape: WaveshaperShape = "tanh";
  private drive = 1;
  private output = 1;
  private mix = 1;

  setCurve(value: string): void {
    const shapes: Record<string, WaveshaperShape> = {
      hardclip: "hardclip",
      hardClip: "hardclip",
      cubicSoft: "cubic",
      tanh: "tanh",
      sigmoid: "sigmoid",
      arctan: "arctan",
      asymmetric: "asymmetric",
    };
    const shape = shapes[value];
    if (shape) {
      this.shape = shape;
    }
  }

  setDrive(value: number): void {
    this.drive = dbToGain(clamp(value, -24, 48));
  }

  setOutput(value: number): void {
    this.output = dbToGain(clamp(value, -48, 24));
  }

  setMix(value: number): void {
    this.mix = clamp(value, 0, 1);
  }

  reset(): void {
    // Stateless processor.
  }

  private compute(value: number): number {
    switch (this.shape) {
      case "hardclip":
        return clamp(value, -1, 1);
      case "cubic": {
        const x = clamp(value, -1.5, 1.5);
        return x - (x * x * x) / 3;
      }
      case "sigmoid":
        return 2 / (1 + Math.exp(-2 * value)) - 1;
      case "arctan":
        return (2 / Math.PI) * Math.atan(value);
      case "asymmetric":
        return value >= 0 ? Math.tanh(value) : Math.tanh(value * 0.55) * 1.3;
      default:
        return Math.tanh(value);
    }
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    for (let i = fromIndex; i < toIndex; i++) {
      const left = input[0][i] ?? 0;
      const right = input[1][i] ?? 0;
      output[0][i] =
        left * (1 - this.mix) +
        this.compute(left * this.drive) * this.output * this.mix;
      output[1][i] =
        right * (1 - this.mix) +
        this.compute(right * this.drive) * this.output * this.mix;
    }
  }
}

export class MaximizerEffect {
  private readonly sampleRate: number;
  private threshold = -0.3;
  private ceiling = -0.1;
  private release = 80;
  private lookahead = 5;
  private readonly bufferL: Float32Array;
  private readonly bufferR: Float32Array;
  private writeIndex = 0;
  private gain = 1;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.bufferL = new Float32Array(Math.ceil(sampleRate * 0.02) + 1);
    this.bufferR = new Float32Array(this.bufferL.length);
  }

  setThreshold(value: number): void {
    this.threshold = clamp(value, -24, 0);
  }

  setCeiling(value: number): void {
    this.ceiling = clamp(value, -12, 0);
  }

  setRelease(value: number): void {
    this.release = clamp(value, 5, 2000);
  }

  setLookahead(value: number): void {
    this.lookahead = clamp(value, 0, 20);
  }

  setLookaheadEnabled(value: boolean): void {
    this.lookahead = value ? 5 : 0;
  }

  reset(): void {
    this.bufferL.fill(0);
    this.bufferR.fill(0);
    this.writeIndex = 0;
    this.gain = 1;
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    const threshold = dbToGain(this.threshold);
    const ceiling = dbToGain(this.ceiling);
    const makeup = ceiling / Math.max(threshold, 0.001);
    const releaseCoeff = Math.exp(
      -1 / (this.sampleRate * this.release * 0.001)
    );
    const lookaheadSamples = Math.min(
      this.bufferL.length - 1,
      Math.round(this.sampleRate * this.lookahead * 0.001)
    );
    for (let i = fromIndex; i < toIndex; i++) {
      const inL = input[0][i] ?? 0;
      const inR = input[1][i] ?? 0;
      this.bufferL[this.writeIndex] = inL;
      this.bufferR[this.writeIndex] = inR;
      const peak = Math.max(Math.abs(inL), Math.abs(inR), 1e-9);
      const requiredGain = Math.min(1, threshold / peak);
      this.gain =
        requiredGain < this.gain
          ? requiredGain
          : 1 + releaseCoeff * (this.gain - 1);
      const readIndex =
        (this.writeIndex - lookaheadSamples + this.bufferL.length) %
        this.bufferL.length;
      output[0][i] = clamp(
        (this.bufferL[readIndex] ?? 0) * this.gain * makeup,
        -1,
        1
      );
      output[1][i] = clamp(
        (this.bufferR[readIndex] ?? 0) * this.gain * makeup,
        -1,
        1
      );
      this.writeIndex = (this.writeIndex + 1) % this.bufferL.length;
    }
  }
}

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
  private readonly modL = new Float32Array(128);
  private readonly modR = new Float32Array(128);
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
    this.carrierMinFreq = clamp(value, 20, this.sampleRate / 2 - 1);
    this.rebuildBands();
  }

  setCarrierMaxFreq(value: number): void {
    this.carrierMaxFreq = clamp(value, 20, this.sampleRate / 2 - 1);
    this.rebuildBands();
  }

  setModulatorMinFreq(value: number): void {
    this.modulatorMinFreq = clamp(value, 20, this.sampleRate / 2 - 1);
    this.rebuildBands();
  }

  setModulatorMaxFreq(value: number): void {
    this.modulatorMaxFreq = clamp(value, 20, this.sampleRate / 2 - 1);
    this.rebuildBands();
  }

  setQStart(value: number): void {
    this.qStart = clamp(value, 1, 60);
    this.rebuildBands();
  }

  setQEnd(value: number): void {
    this.qEnd = clamp(value, 1, 60);
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
          [this.modL, this.modR],
          [this.modL, this.modR],
          fromIndex,
          toIndex
        );
      } else {
        modulatorFilter.process(
          modulator,
          [this.modL, this.modR],
          fromIndex,
          toIndex
        );
      }
      carrierFilter.process(
        input,
        [this.carrierL, this.carrierR],
        fromIndex,
        toIndex
      );
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

export class NeuralAmpEffect {
  private drive = 0;
  private tone = 0.5;
  private presence = 0.5;
  private output = -6;
  private mono = false;
  private mix = 1;
  private readonly highPass: BiquadFilter;
  private readonly lowPass: BiquadFilter;

  constructor(sampleRate: number) {
    this.highPass = new BiquadFilter(sampleRate);
    this.highPass.type = "highpass";
    this.highPass.frequency = 70;
    this.highPass.Q = 0.7;
    this.lowPass = new BiquadFilter(sampleRate);
    this.lowPass.type = "lowpass";
    this.lowPass.frequency = 6500;
    this.lowPass.Q = 0.7;
  }

  setInput(value: number): void {
    this.drive = clamp(value, -72, 12);
  }

  setTone(value: number): void {
    this.tone = clamp(value, 0, 1);
    this.lowPass.frequency = 1800 + this.tone * 10_000;
  }

  setPresence(value: number): void {
    this.presence = clamp(value, 0, 1);
    this.highPass.frequency = 35 + this.presence * 135;
  }

  setOutput(value: number): void {
    this.output = clamp(value, -48, 12);
  }

  setCabinetEnabled(value: boolean): void {
    this.lowPass.frequency = value ? 6500 : 19_000;
  }

  setMono(value: boolean): void {
    this.mono = value;
  }

  setMix(value: number): void {
    this.mix = clamp(value, 0, 1);
  }

  reset(): void {
    this.highPass.reset();
    this.lowPass.reset();
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    this.highPass.process(input, output, fromIndex, toIndex);
    const drive = dbToGain(this.drive);
    const makeup = dbToGain(this.output);
    for (let i = fromIndex; i < toIndex; i++) {
      output[0][i] = Math.tanh((output[0][i] ?? 0) * drive) * makeup;
      output[1][i] = Math.tanh((output[1][i] ?? 0) * drive) * makeup;
    }
    this.lowPass.process(output, output, fromIndex, toIndex);
    for (let i = fromIndex; i < toIndex; i++) {
      const left = input[0][i] ?? 0;
      const right = input[1][i] ?? 0;
      const processedLeft = output[0][i] ?? 0;
      const processedRight = output[1][i] ?? 0;
      const mono = (processedLeft + processedRight) * 0.5;
      output[0][i] =
        left * (1 - this.mix) + (this.mono ? mono : processedLeft) * this.mix;
      output[1][i] =
        right * (1 - this.mix) + (this.mono ? mono : processedRight) * this.mix;
    }
  }
}

export class WerkstattEffect {
  private readonly sampleRate: number;
  private sampleFunction: (input: number, channel: number) => number = (
    input
  ) => input;
  private source = "return input;";
  private parameters: Record<string, number> = {};
  private failed = false;
  private parameterA = 0.5;
  private parameterB = 0.5;
  private phase = 0;
  private heldL = 0;
  private heldR = 0;

  constructor(sampleRate = 48_000) {
    this.sampleRate = sampleRate;
  }

  setSource(value: string): void {
    const source = value.trim();
    this.source = source;
    this.failed = false;
    if (source === "ring" || source === "rectify" || source === "sampleHold") {
      return;
    }
    const expression = source
      .replace(WERKSTATT_RETURN_PREFIX, "")
      .replace(WERKSTATT_TRAILING_SEMICOLON, "")
      .trim();
    const identifiers = expression.match(WERKSTATT_IDENTIFIER) ?? [];
    const allowedIdentifiers = new Set([
      "input",
      "channel",
      "sampleRate",
      "p",
      "Math",
      ...Object.getOwnPropertyNames(Math),
      ...Object.keys(this.parameters),
    ]);
    if (
      !expression ||
      WERKSTATT_FORBIDDEN_SOURCE.test(expression) ||
      identifiers.some((identifier) => !allowedIdentifiers.has(identifier))
    ) {
      this.failed = true;
      this.sampleFunction = (input) => input;
      return;
    }
    try {
      const evaluate = Function(
        "input",
        "channel",
        "sampleRate",
        "p",
        `"use strict"; return (${expression});`
      ) as (
        input: number,
        channel: number,
        sampleRate: number,
        parameters: Readonly<Record<string, number>>
      ) => unknown;
      this.sampleFunction = (input, channel) => {
        const result = evaluate(
          input,
          channel,
          this.sampleRate,
          this.parameters
        );
        return typeof result === "number" && Number.isFinite(result)
          ? result
          : input;
      };
    } catch {
      this.failed = true;
      this.sampleFunction = (input) => input;
    }
  }

  setParameters(value: Record<string, number>): void {
    this.parameters = Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, number] =>
        Number.isFinite(entry[1])
      )
    );
    this.parameterA = clamp(
      value.a ?? value.parameterA ?? this.parameterA,
      0,
      1
    );
    this.parameterB = clamp(
      value.b ?? value.parameterB ?? this.parameterB,
      0,
      1
    );
    this.setSource(this.source);
  }

  reset(): void {
    this.phase = 0;
    this.heldL = 0;
    this.heldR = 0;
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    for (let i = fromIndex; i < toIndex; i++) {
      const left = input[0][i] ?? 0;
      const right = input[1][i] ?? 0;
      switch (this.source) {
        case "ring": {
          const carrier = Math.sin(this.phase * Math.PI * 2);
          output[0][i] = left * carrier;
          output[1][i] = right * carrier;
          this.phase = (this.phase + 0.0002 + this.parameterA * 0.05) % 1;
          break;
        }
        case "rectify":
          output[0][i] =
            left * (1 - this.parameterA) + Math.abs(left) * this.parameterA;
          output[1][i] =
            right * (1 - this.parameterA) + Math.abs(right) * this.parameterA;
          break;
        case "sampleHold": {
          this.phase += 0.001 + this.parameterA * 0.2;
          if (this.phase >= 1) {
            this.phase %= 1;
            this.heldL = left;
            this.heldR = right;
          }
          output[0][i] = this.heldL * (0.25 + this.parameterB * 0.75);
          output[1][i] = this.heldR * (0.25 + this.parameterB * 0.75);
          break;
        }
        default:
          if (this.failed) {
            output[0][i] = left;
            output[1][i] = right;
            break;
          }
          try {
            output[0][i] = this.sampleFunction(left, 0);
            output[1][i] = this.sampleFunction(right, 1);
          } catch {
            this.failed = true;
            output[0][i] = left;
            output[1][i] = right;
          }
      }
    }
  }
}

const SCALE_INTERVALS: Record<string, readonly number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
const LEGACY_SCALE_ALIASES: Record<string, string> = {
  pentatonicMajor: "majorPentatonic",
  pentatonicMinor: "minorPentatonic",
};

export class AutotuneEffect {
  private readonly sampleRate: number;
  private readonly shifter = new PhaseVocoder();
  private readonly detector = new Float32Array(2048);
  private detectorIndex = 0;
  private key = 0;
  private scale = "chromatic";
  private amount = 1;
  private retune = 40;
  private shift = 0;
  private smoothing = 0.25;
  private factor = 1;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  setKey(value: string): void {
    const keyNames = [
      "C",
      "C#",
      "D",
      "D#",
      "E",
      "F",
      "F#",
      "G",
      "G#",
      "A",
      "A#",
      "B",
    ];
    const index = keyNames.indexOf(value);
    this.key = index >= 0 ? index : 0;
  }

  setScale(value: string): void {
    const normalized = LEGACY_SCALE_ALIASES[value] ?? value;
    if (SCALE_INTERVALS[normalized]) {
      this.scale = normalized;
    }
  }

  setAmount(value: number): void {
    this.amount = clamp(value, 0, 1);
  }

  setRetune(value: number): void {
    this.retune = clamp(value, 0, 500);
  }

  setShift(value: number): void {
    this.shift = clamp(value, -12, 12);
  }

  setSmoothing(value: number): void {
    this.smoothing = clamp(value, 0, 1);
  }

  reset(): void {
    this.detector.fill(0);
    this.detectorIndex = 0;
    this.factor = 1;
    this.shifter.reset();
  }

  private detectFrequency(): number | null {
    let bestLag = 0;
    let bestCorrelation = 0;
    const minimumLag = Math.floor(this.sampleRate / 1000);
    const maximumLag = Math.min(
      this.detector.length / 2,
      Math.ceil(this.sampleRate / 65)
    );
    for (let lag = minimumLag; lag <= maximumLag; lag += 2) {
      let correlation = 0;
      for (let index = lag; index < this.detector.length; index += 4) {
        correlation +=
          (this.detector[index] ?? 0) * (this.detector[index - lag] ?? 0);
      }
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }
    return bestLag > 0 && bestCorrelation > 0.001
      ? this.sampleRate / bestLag
      : null;
  }

  private updateFactor(): void {
    const frequency = this.detectFrequency();
    if (!frequency) {
      return;
    }
    const midi = 69 + 12 * Math.log2(frequency / 440);
    const allowed = SCALE_INTERVALS[this.scale] ?? SCALE_INTERVALS.chromatic;
    let target = Math.round(midi);
    let distance = Number.POSITIVE_INFINITY;
    for (let octave = -1; octave <= 1; octave++) {
      for (const interval of allowed ?? []) {
        const candidate =
          Math.floor(midi / 12) * 12 + octave * 12 + this.key + interval;
        if (Math.abs(candidate - midi) < distance) {
          distance = Math.abs(candidate - midi);
          target = candidate;
        }
      }
    }
    const correction = (target - midi) * this.amount + this.shift;
    const desired = 2 ** (correction / 12);
    const response =
      this.retune === 0
        ? 1
        : 1 -
          Math.exp(
            -(this.detector.length / this.sampleRate) / (this.retune * 0.001)
          );
    this.factor +=
      (desired - this.factor) * response * (1 - this.smoothing * 0.9);
    this.shifter.setPitchFactor(this.factor);
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    for (let i = fromIndex; i < toIndex; i++) {
      this.detector[this.detectorIndex] =
        ((input[0][i] ?? 0) + (input[1][i] ?? 0)) * 0.5;
      this.detectorIndex++;
      if (this.detectorIndex >= this.detector.length) {
        this.detectorIndex = 0;
        this.updateFactor();
      }
    }
    this.shifter.process(input, output, fromIndex, toIndex);
  }
}
