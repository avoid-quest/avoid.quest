/**
 * Peak Level Detection
 *
 * Tracks peak levels for clipping indicators and peak meters.
 */

export class PeakMeter {
  private readonly decayRate: number;
  private readonly holdTimeMs: number;
  private readonly minDb: number;
  private currentPeakL = 0;
  private currentPeakR = 0;
  private holdPeakL = 0;
  private holdPeakR = 0;
  private holdCounterL = 0;
  private holdCounterR = 0;
  private clippedL = false;
  private clippedR = false;

  /**
   * Create a peak meter
   * @param sampleRate Sample rate in Hz
   * @param decayMs Decay time in milliseconds (default 1500ms)
   * @param holdTimeMs Time to hold peak before decay (default 2000ms)
   * @param minDb Minimum dB value (default -60dB)
   */
  constructor(
    sampleRate: number,
    decayMs = 1500,
    holdTimeMs = 2000,
    minDb = -60
  ) {
    // Calculate samples to decay from 1 to 0 over decayMs
    const decaySamples = (decayMs / 1000) * sampleRate;
    this.decayRate = 1 / decaySamples;
    this.holdTimeMs = holdTimeMs;
    this.minDb = minDb;
  }

  /**
   * Process a block of audio and update peak levels
   */
  process(
    inputL: Float32Array,
    inputR: Float32Array,
    fromIndex: number,
    toIndex: number
  ): void {
    const blockSize = toIndex - fromIndex;
    if (blockSize <= 0) {
      return;
    }

    // Find peak in block
    let blockPeakL = 0;
    let blockPeakR = 0;

    for (let i = fromIndex; i < toIndex; i++) {
      const absL = Math.abs(inputL[i] ?? 0);
      const absR = Math.abs(inputR[i] ?? 0);

      if (absL > blockPeakL) {
        blockPeakL = absL;
      }
      if (absR > blockPeakR) {
        blockPeakR = absR;
      }

      // Check for clipping
      if (absL >= 1.0) {
        this.clippedL = true;
      }
      if (absR >= 1.0) {
        this.clippedR = true;
      }
    }

    // Update current peak with new peak or decay
    if (blockPeakL >= this.currentPeakL) {
      this.currentPeakL = blockPeakL;
      this.holdCounterL = this.holdTimeMs;
    } else if (this.holdCounterL > 0) {
      this.holdCounterL -= blockSize;
    } else {
      this.currentPeakL = Math.max(
        0,
        this.currentPeakL - this.decayRate * blockSize
      );
    }

    if (blockPeakR >= this.currentPeakR) {
      this.currentPeakR = blockPeakR;
      this.holdCounterR = this.holdTimeMs;
    } else if (this.holdCounterR > 0) {
      this.holdCounterR -= blockSize;
    } else {
      this.currentPeakR = Math.max(
        0,
        this.currentPeakR - this.decayRate * blockSize
      );
    }

    // Track hold peaks (the highest peak seen)
    if (blockPeakL > this.holdPeakL) {
      this.holdPeakL = blockPeakL;
    }
    if (blockPeakR > this.holdPeakR) {
      this.holdPeakR = blockPeakR;
    }
  }

  /**
   * Get current peak levels in dB
   */
  getLevelsDb(): { left: number; right: number } {
    return {
      left: this.linearToDb(this.currentPeakL),
      right: this.linearToDb(this.currentPeakR),
    };
  }

  /**
   * Get current peak levels as linear values
   */
  getLevelsLinear(): { left: number; right: number } {
    return {
      left: this.currentPeakL,
      right: this.currentPeakR,
    };
  }

  /**
   * Get hold peak levels (highest peaks since last reset)
   */
  getHoldPeaksDb(): { left: number; right: number } {
    return {
      left: this.linearToDb(this.holdPeakL),
      right: this.linearToDb(this.holdPeakR),
    };
  }

  /**
   * Check if clipping has occurred
   */
  hasClipped(): { left: boolean; right: boolean } {
    return {
      left: this.clippedL,
      right: this.clippedR,
    };
  }

  /**
   * Reset clipping indicators
   */
  resetClipping(): void {
    this.clippedL = false;
    this.clippedR = false;
  }

  /**
   * Reset all meter state
   */
  reset(): void {
    this.currentPeakL = 0;
    this.currentPeakR = 0;
    this.holdPeakL = 0;
    this.holdPeakR = 0;
    this.holdCounterL = 0;
    this.holdCounterR = 0;
    this.clippedL = false;
    this.clippedR = false;
  }

  private linearToDb(linear: number): number {
    if (linear < 1e-10) {
      return this.minDb;
    }
    return Math.max(this.minDb, 20 * Math.log10(linear));
  }
}
