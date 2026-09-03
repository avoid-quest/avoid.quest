import { clamp, dbToGain } from "./stock-effect-utils.js";
import type { StereoChannels } from "./types.js";

export class GateEffect {
  private readonly sampleRate: number;
  private threshold = -36;
  private attack = 5;
  private release = 120;
  private hold = 20;
  private floor = -80;
  private returnAmount = 0;
  private inverse = false as boolean;
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
    this.attack = clamp(value, 0, 1000);
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
    for (let i = fromIndex; i < toIndex; i += 1) {
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
        this.holdSamples -= 1;
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
    for (let i = fromIndex; i < toIndex; i += 1) {
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
