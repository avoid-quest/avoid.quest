/**
 * Distortion Effect
 *
 * Soft-clipping distortion using atan waveshaping.
 * Drive ranges from subtle warmth to heavy saturation.
 * Includes auto gain compensation to maintain consistent volume.
 */

import {
  RenderQuantum,
  ResamplerStereo,
  type StereoMatrix,
} from "@opendaw/lib-dsp";

export class Distortion {
  private readonly buffer: StereoMatrix.Channels;
  private resampler: ResamplerStereo | null = null;
  private oversamplingFactor: 1 | 2 | 4 = 1;
  // Drive multiplier (1 = clean, 50 = heavy distortion)
  private drive = 1;
  // Auto gain compensation (reduces output as drive increases)
  private makeup = 1;

  // sampleRate parameter kept for API consistency with other effects
  constructor(_sampleRate: number) {
    this.buffer = [
      new Float32Array(RenderQuantum * 4),
      new Float32Array(RenderQuantum * 4),
    ];
  }

  /**
   * Set distortion amount (0-100 scale)
   */
  setAmount(value: number): void {
    // Map 0-100 to drive range: 1 (clean) to 50 (heavy)
    const normalized = Math.max(0, Math.min(100, value)) / 100;
    // Exponential curve for more musical response
    this.drive = 1 + normalized * normalized * 49;

    // Auto gain compensation: reduce output as drive increases
    // At drive=1: makeup=1 (no change)
    // At drive=50: makeup≈0.14 (1/sqrt(50))
    this.makeup = 1 / Math.sqrt(this.drive);
  }

  getAmount(): number {
    // Reverse the exponential curve from setAmount:
    // drive = 1 + normalized^2 * 49, so normalized = sqrt((drive-1)/49)
    const normalized = Math.sqrt((this.drive - 1) / 49);
    return normalized * 100;
  }

  reset(): void {
    // No state to reset
  }

  setOversample(factor: "none" | "2x" | "4x"): void {
    const factorMap = { none: 1, "2x": 2, "4x": 4 } as const;
    const numeric = factorMap[factor];
    this.oversamplingFactor = numeric;
    this.resampler =
      numeric === 1 ? null : new ResamplerStereo(numeric as 2 | 4);
  }

  process(
    input: [Float32Array, Float32Array],
    output: [Float32Array, Float32Array],
    fromIndex: number,
    toIndex: number
  ): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;

    if (this.drive <= 1) {
      // No distortion - pass through
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = inputL[i] ?? 0;
        outputR[i] = inputR[i] ?? 0;
      }
      return;
    }

    const inv = (2 / Math.PI) * this.makeup;

    // No oversampling - direct processing
    if (this.oversamplingFactor === 1 || !this.resampler) {
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = inv * Math.atan(this.drive * (inputL[i] ?? 0));
        outputR[i] = inv * Math.atan(this.drive * (inputR[i] ?? 0));
      }
      return;
    }

    // Upsample
    this.resampler.upsample(input, this.buffer, fromIndex, toIndex);
    const oversampledLength = (toIndex - fromIndex) * this.oversamplingFactor;
    const [oversampledL, oversampledR] = this.buffer;

    // Process at higher sample rate
    for (let i = 0; i < oversampledLength; i++) {
      oversampledL[i] = inv * Math.atan(this.drive * (oversampledL[i] ?? 0));
      oversampledR[i] = inv * Math.atan(this.drive * (oversampledR[i] ?? 0));
    }

    // Downsample
    this.resampler.downsample(this.buffer, output, fromIndex, toIndex);
  }
}
