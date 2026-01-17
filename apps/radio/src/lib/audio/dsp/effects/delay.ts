/**
 * Delay Effect
 *
 * Stereo delay effect with feedback control.
 */

import type { StereoChannels } from "./types.js";

export class Delay {
  private readonly sampleRate: number;
  private readonly maxDelaySamples: number;
  private readonly bufferL: Float32Array;
  private readonly bufferR: Float32Array;
  private writeIndex = 0;

  // Parameters
  private delaySamples = 0;
  private feedback = 0.3;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    // Max 2 seconds of delay
    this.maxDelaySamples = Math.ceil(sampleRate * 2);
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
  }

  setFeedback(value: number): void {
    // Clamp feedback to prevent runaway
    this.feedback = Math.max(0, Math.min(0.95, value));
  }

  reset(): void {
    this.bufferL.fill(0);
    this.bufferR.fill(0);
    this.writeIndex = 0;
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
      // Calculate read position
      let readIndex = this.writeIndex - this.delaySamples;
      if (readIndex < 0) {
        readIndex += this.maxDelaySamples;
      }

      // Read delayed samples
      const delayedL = this.bufferL[readIndex] ?? 0;
      const delayedR = this.bufferR[readIndex] ?? 0;

      // Mix input with feedback
      const inL = inputL[i] ?? 0;
      const inR = inputR[i] ?? 0;

      // Write to buffer (input + feedback from delayed)
      this.bufferL[this.writeIndex] = inL + delayedL * this.feedback;
      this.bufferR[this.writeIndex] = inR + delayedR * this.feedback;

      // Output is the delayed signal (wet only, dry/wet mixing handled by processor)
      outputL[i] = delayedL;
      outputR[i] = delayedR;

      // Advance write position
      this.writeIndex = (this.writeIndex + 1) % this.maxDelaySamples;
    }
  }
}
