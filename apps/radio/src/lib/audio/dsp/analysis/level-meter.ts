/**
 * Level Meter
 *
 * Stereo RMS level metering using openDAW's RMS class.
 * Provides smoothed level readings for VU meter visualizations.
 */

import { RMS } from "@opendaw/lib-dsp";

export type StereoLevels = {
  left: number;
  right: number;
  mono: number;
  peak: number;
};

export class LevelMeter {
  private readonly rmsL: RMS;
  private readonly rmsR: RMS;
  private peakL = 0;
  private peakR = 0;
  private readonly peakDecay: number;

  /**
   * @param windowSize RMS averaging window size in samples
   * @param peakDecayRate Peak meter decay rate per block (0.95 = slow, 0.8 = fast)
   */
  constructor(windowSize = 2048, peakDecayRate = 0.95) {
    this.rmsL = new RMS(windowSize);
    this.rmsR = new RMS(windowSize);
    this.peakDecay = peakDecayRate;
  }

  /**
   * Process stereo audio and return levels
   * All values are linear (0-1 range for normalized audio)
   */
  process(
    left: Float32Array,
    right: Float32Array,
    fromIndex: number,
    toIndex: number
  ): StereoLevels {
    // Calculate RMS levels
    const levelL = this.rmsL.processBlock(left, fromIndex, toIndex);
    const levelR = this.rmsR.processBlock(right, fromIndex, toIndex);

    // Track peaks with decay
    for (let i = fromIndex; i < toIndex; i += 1) {
      const absL = Math.abs(left[i] ?? 0);
      const absR = Math.abs(right[i] ?? 0);
      if (absL > this.peakL) {
        this.peakL = absL;
      }
      if (absR > this.peakR) {
        this.peakR = absR;
      }
    }

    // Decay peaks
    this.peakL *= this.peakDecay;
    this.peakR *= this.peakDecay;

    return {
      left: levelL,
      mono: (levelL + levelR) / 2,
      peak: Math.max(this.peakL, this.peakR),
      right: levelR,
    };
  }

  /**
   * Clear meter state
   */
  clear(): void {
    this.rmsL.clear();
    this.rmsR.clear();
    this.peakL = 0;
    this.peakR = 0;
  }
}
