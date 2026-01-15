import { Crusher, type StereoMatrix } from "@opendaw/lib-dsp";
import { type int } from "@opendaw/lib-std";

/**
 * Bit crusher effect wrapper
 * Uses Crusher from @opendaw/lib-dsp directly
 */
export class CrusherEffect {
  private readonly dsp: Crusher;

  constructor(sampleRate: number) {
    this.dsp = new Crusher(sampleRate);
  }

  setCrush(value: number): void {
    // Crusher expects 1.0 - crush rate (inverted)
    this.dsp.setCrush(1.0 - value);
  }

  setBitDepth(value: number): void {
    this.dsp.setBitDepth(value);
  }

  setBoost(value: number): void {
    this.dsp.setBoost(value);
  }

  setMix(value: number): void {
    this.dsp.setMix(value);
  }

  reset(): void {
    this.dsp.reset();
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
    this.dsp.process(input, output, fromIndex, toIndex);
  }
}
