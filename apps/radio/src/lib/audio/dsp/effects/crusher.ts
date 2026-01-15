/**
 * Bit Crusher Effect
 *
 * Uses Crusher from @opendaw/lib-dsp directly.
 */

import { Crusher } from "@opendaw/lib-dsp";
import type { StereoChannels } from "./types.js";

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
    input: StereoChannels,
    output: StereoChannels,
    fromIndex: number,
    toIndex: number
  ): void {
    this.dsp.process(input, output, fromIndex, toIndex);
  }
}
