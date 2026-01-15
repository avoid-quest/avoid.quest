/**
 * Wave Folding Effect
 *
 * Ported from openDAW FoldDeviceProcessor.
 */

import {
  dbToGain,
  RenderQuantum,
  ResamplerStereo,
  type StereoMatrix,
  wavefold,
} from "@opendaw/lib-dsp";

const maxOversampleFactor = 8 as const;

export class FoldEffect {
  private readonly buffer: StereoMatrix.Channels;
  private resampler: ResamplerStereo;
  private oversamplingFactor = 2;
  private smoothInputGain = 1.0;
  private smoothOutputGain = 1.0;
  private targetInputGain = 1.0;
  private targetOutputGain = 1.0;

  constructor(_sampleRate: number) {
    this.buffer = [
      new Float32Array(RenderQuantum * maxOversampleFactor),
      new Float32Array(RenderQuantum * maxOversampleFactor),
    ];
    this.resampler = new ResamplerStereo(2);
  }

  setAmount(value: number): void {
    // Convert to linear gain
    this.targetInputGain = dbToGain(value);
  }

  setVolume(value: number): void {
    // Convert to linear gain
    this.targetOutputGain = dbToGain(value);
  }

  setOversample(factor: 2 | 4 | 8): void {
    this.oversamplingFactor = factor;
    this.resampler = new ResamplerStereo(factor);
  }

  reset(): void {
    this.smoothInputGain = this.targetInputGain;
    this.smoothOutputGain = this.targetOutputGain;
  }

  process(
    input: StereoMatrix.Channels,
    output: StereoMatrix.Channels,
    fromIndex: number,
    toIndex: number
  ): void {
    // Upsample
    this.resampler.upsample(input, this.buffer, fromIndex, toIndex);
    const oversampledLength = (toIndex - fromIndex) * this.oversamplingFactor;
    const [oversampledL, oversampledR] = this.buffer;

    // Smooth gain changes
    const inputGainStep =
      (this.targetInputGain - this.smoothInputGain) / oversampledLength;
    const outputGainStep =
      (this.targetOutputGain - this.smoothOutputGain) / oversampledLength;

    // Process with wave folding
    for (let i = 0; i < oversampledLength; i++) {
      this.smoothInputGain += inputGainStep;
      this.smoothOutputGain += outputGainStep;
      oversampledL[i] =
        wavefold((oversampledL[i] ?? 0) * this.smoothInputGain) *
        this.smoothOutputGain;
      oversampledR[i] =
        wavefold((oversampledR[i] ?? 0) * this.smoothInputGain) *
        this.smoothOutputGain;
    }

    // Downsample
    this.resampler.downsample(this.buffer, output, fromIndex, toIndex);
  }
}
