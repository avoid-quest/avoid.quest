/**
 * Bit Crusher Effect
 *
 * Uses Crusher from @opendaw/lib-dsp with optional auto gain compensation.
 * openDAW's Crusher has built-in compensation: postGain = -boost/2.
 * When autoGain is OFF, we counteract this to give full boost.
 */

import { Crusher, dbToGain } from "@opendaw/lib-dsp";
import type { StereoChannels } from "./types.js";

export class CrusherEffect {
  private readonly dsp: Crusher;
  private autoGain = true as boolean;
  private boost = 0;

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
    this.boost = value;
    this.dsp.setBoost(value);
  }

  setMix(value: number): void {
    this.dsp.setMix(value);
  }

  setAutoGain(enabled: boolean): void {
    this.autoGain = enabled;
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

    // When autoGain is OFF, counteract the built-in compensation (-boost/2)
    // by applying additional gain of +boost/2
    if (!this.autoGain && this.boost !== 0) {
      const compensationGain = dbToGain(this.boost / 2);
      const [outL, outR] = output;
      for (let i = fromIndex; i < toIndex; i += 1) {
        outL[i] = (outL[i] ?? 0) * compensationGain;
        outR[i] = (outR[i] ?? 0) * compensationGain;
      }
    }
  }
}
