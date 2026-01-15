import { dbToGain, ResamplerStereo, wavefold, RenderQuantum, type StereoMatrix } from "@opendaw/lib-dsp";
import { type int } from "@opendaw/lib-std";

const maxOversampleFactor = 8 as const;

/**
 * Wave folding effect
 * Ported from openDAW FoldDeviceProcessor
 */
export class FoldEffect {
  private readonly sampleRate: number;
  private readonly buffer: StereoMatrix.Channels;
  private resampler: ResamplerStereo;
  private oversamplingFactor: int = 2;
  private smoothInputGain: number = 1.0;
  private smoothOutputGain: number = 1.0;
  private targetInputGain: number = 1.0;
  private targetOutputGain: number = 1.0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
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
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: int,
    toIndex: int
  ): void {
    const input: StereoMatrix.Channels = [inputL, inputR];
    const output: StereoMatrix.Channels = [outputL, outputR];

    // Upsample
    this.resampler.upsample(input, this.buffer, fromIndex, toIndex);
    const oversampledLength = (toIndex - fromIndex) * this.oversamplingFactor;
    const [oversampledL, oversampledR] = this.buffer;

    // Smooth gain changes
    const inputGainStep = (this.targetInputGain - this.smoothInputGain) / oversampledLength;
    const outputGainStep = (this.targetOutputGain - this.smoothOutputGain) / oversampledLength;

    // Process with wave folding
    for (let i = 0; i < oversampledLength; i++) {
      this.smoothInputGain += inputGainStep;
      this.smoothOutputGain += outputGainStep;
      oversampledL[i] = wavefold(oversampledL[i]! * this.smoothInputGain) * this.smoothOutputGain;
      oversampledR[i] = wavefold(oversampledR[i]! * this.smoothInputGain) * this.smoothOutputGain;
    }

    // Downsample
    this.resampler.downsample(this.buffer, output, fromIndex, toIndex);
  }
}
