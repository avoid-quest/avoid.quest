/**
 * Delay Effect
 *
 * Stereo delay effect with feedback control.
 */

import { clampEffectTempo } from "./tempo.js";
import type { StereoChannels } from "./types.js";

const dbToGain = (value: number): number => 10 ** (value / 20);
const MAX_DELAY_SECONDS = 20;

const fractionToBeats = (value: string): number => {
  if (value.toLowerCase() === "off") {
    return 0;
  }
  const [numerator, denominator] = value.split("/").map(Number);
  return numerator && denominator ? (numerator * 4) / denominator : 1;
};

export class Delay {
  private readonly sampleRate: number;
  private readonly maxDelaySamples: number;
  private readonly bufferL: Float32Array;
  private readonly bufferR: Float32Array;
  private writeIndex = 0;

  // Parameters
  private delaySamples = 0;
  private feedback = 0.3;
  private tempo = 120;
  private tempoSync = false;
  private tempoDivision = "1/4";
  private preDelay = 0;
  private crossFeedback = 0;
  private filterFrequency = 12_000;
  private lfoRate = 0;
  private lfoDepth = 0;
  private delayMusical = "Off";
  private delayMillis = 300;
  private officialTimingConfigured = false;
  private preSyncTimeLeft = "Off";
  private preMillisTimeLeft = 0;
  private preSyncTimeRight = "Off";
  private preMillisTimeRight = 0;
  private dry = 0;
  private wet = 1;
  private lfoPhase = 0;
  private filteredL = 0;
  private filteredR = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.maxDelaySamples = Math.ceil(sampleRate * MAX_DELAY_SECONDS);
    this.bufferL = new Float32Array(this.maxDelaySamples);
    this.bufferR = new Float32Array(this.maxDelaySamples);
    this.setDelayTime(0.3);
  }

  setDelayTime(seconds: number): void {
    const samples = Math.round(seconds * this.sampleRate);
    this.delaySamples = Math.max(
      1,
      Math.min(this.maxDelaySamples - 1, samples)
    );
    this.delayMusical = "Off";
    this.delayMillis = seconds * 1000;
    this.officialTimingConfigured = false;
  }

  setFeedback(value: number): void {
    // Clamp feedback to prevent runaway
    this.feedback = Math.max(0, Math.min(0.95, value));
  }

  setTempo(value: number): void {
    this.tempo = clampEffectTempo(value);
  }

  setTempoSync(value: boolean): void {
    this.tempoSync = value;
  }

  setTempoDivision(value: string): void {
    this.tempoDivision = value;
  }

  setDelayMusical(value: string): void {
    this.delayMusical = value;
    this.officialTimingConfigured = true;
  }

  setDelayMillis(value: number): void {
    this.delayMillis = Math.max(0, Math.min(1000, value));
    this.officialTimingConfigured = true;
  }

  setPreSyncTimeLeft(value: string): void {
    this.preSyncTimeLeft = value;
  }

  setPreMillisTimeLeft(value: number): void {
    this.preMillisTimeLeft = Math.max(0, Math.min(1000, value));
  }

  setPreSyncTimeRight(value: string): void {
    this.preSyncTimeRight = value;
  }

  setPreMillisTimeRight(value: number): void {
    this.preMillisTimeRight = Math.max(0, Math.min(1000, value));
  }

  setPreDelay(value: number): void {
    this.preDelay = Math.max(0, Math.min(1, value));
  }

  setCrossFeedback(value: number): void {
    this.crossFeedback = Math.max(0, Math.min(1, value));
  }

  setFilterFrequency(value: number): void {
    this.filterFrequency = Math.max(
      20,
      Math.min(this.sampleRate / 2 - 1, value)
    );
  }

  setLfoRate(value: number): void {
    this.lfoRate = Math.max(0, Math.min(20, value));
  }

  setLfoDepth(value: number): void {
    this.lfoDepth = Math.max(0, Math.min(50, value));
  }

  setFilter(value: number): void {
    const normalized = Math.max(-1, Math.min(1, value));
    this.setFilterFrequency(
      20 * (this.sampleRate / 40) ** ((normalized + 1) * 0.5)
    );
  }

  setDry(value: number): void {
    this.dry = dbToGain(value);
  }

  setWet(value: number): void {
    this.wet = dbToGain(value);
  }

  reset(): void {
    this.bufferL.fill(0);
    this.bufferR.fill(0);
    this.writeIndex = 0;
    this.filteredL = 0;
    this.filteredR = 0;
    this.lfoPhase = 0;
  }

  process(
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;
    const secondsPerBeat = 60 / this.tempo;
    const officialMain =
      fractionToBeats(this.delayMusical) * secondsPerBeat +
      this.delayMillis * 0.001;
    let baseDelay = officialMain;
    if (this.delayMusical === "Off" && !this.officialTimingConfigured) {
      baseDelay = this.tempoSync
        ? secondsPerBeat * fractionToBeats(this.tempoDivision)
        : this.delaySamples / this.sampleRate;
    }
    const leftPreDelay =
      fractionToBeats(this.preSyncTimeLeft) * secondsPerBeat +
      this.preMillisTimeLeft * 0.001;
    const rightPreDelay =
      fractionToBeats(this.preSyncTimeRight) * secondsPerBeat +
      this.preMillisTimeRight * 0.001;
    const filterCoefficient = Math.exp(
      (-2 * Math.PI * this.filterFrequency) / this.sampleRate
    );

    for (let i = fromIndex; i < toIndex; i++) {
      const modulation =
        Math.sin(this.lfoPhase * Math.PI * 2) * this.lfoDepth * 0.001;
      const activeDelaySamplesL = Math.max(
        1,
        Math.min(
          this.maxDelaySamples - 1,
          Math.round(
            (baseDelay + this.preDelay + leftPreDelay + modulation) *
              this.sampleRate
          )
        )
      );
      const activeDelaySamplesR = Math.max(
        1,
        Math.min(
          this.maxDelaySamples - 1,
          Math.round(
            (baseDelay + this.preDelay + rightPreDelay + modulation) *
              this.sampleRate
          )
        )
      );
      // Calculate read position
      let readIndexL = this.writeIndex - activeDelaySamplesL;
      if (readIndexL < 0) {
        readIndexL += this.maxDelaySamples;
      }
      let readIndexR = this.writeIndex - activeDelaySamplesR;
      if (readIndexR < 0) {
        readIndexR += this.maxDelaySamples;
      }

      // Read delayed samples
      const delayedL = this.bufferL[readIndexL] ?? 0;
      const delayedR = this.bufferR[readIndexR] ?? 0;
      this.filteredL =
        delayedL * (1 - filterCoefficient) + this.filteredL * filterCoefficient;
      this.filteredR =
        delayedR * (1 - filterCoefficient) + this.filteredR * filterCoefficient;

      // Mix input with feedback
      const inL = inputL[i] ?? 0;
      const inR = inputR[i] ?? 0;

      // Write to buffer (input + feedback from delayed)
      const straightFeedback = this.feedback * (1 - this.crossFeedback);
      const crossFeedback = this.feedback * this.crossFeedback;
      this.bufferL[this.writeIndex] =
        inL +
        this.filteredL * straightFeedback +
        this.filteredR * crossFeedback;
      this.bufferR[this.writeIndex] =
        inR +
        this.filteredR * straightFeedback +
        this.filteredL * crossFeedback;

      // Match the stock device's independent dry and wet trims.
      outputL[i] = inL * this.dry + delayedL * this.wet;
      outputR[i] = inR * this.dry + delayedR * this.wet;

      // Advance write position
      this.writeIndex = (this.writeIndex + 1) % this.maxDelaySamples;
      this.lfoPhase += this.lfoRate / this.sampleRate;
      if (this.lfoPhase >= 1) {
        this.lfoPhase -= 1;
      }
    }
  }
}
