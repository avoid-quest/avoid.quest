/**
 * RMS (Root Mean Square) Level Metering
 *
 * Calculates the RMS level of audio signals for VU meters and level indicators.
 */

export class RMSMeter {
  private readonly smoothingFactor: number;
  private readonly minDb: number;
  private currentRmsL = 0;
  private currentRmsR = 0;

  /**
   * Create an RMS meter
   * @param sampleRate Sample rate in Hz
   * @param smoothingMs Smoothing time in milliseconds (default 300ms for VU-style response)
   * @param minDb Minimum dB value (default -60dB)
   */
  constructor(sampleRate: number, smoothingMs = 300, minDb = -60) {
    // Calculate smoothing factor for exponential moving average
    this.smoothingFactor = Math.exp(-1 / ((smoothingMs / 1000) * sampleRate));
    this.minDb = minDb;
  }

  /**
   * Process a block of audio and update RMS levels
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

    // Calculate sum of squares for block
    let sumL = 0;
    let sumR = 0;

    for (let i = fromIndex; i < toIndex; i++) {
      const sampleL = inputL[i] ?? 0;
      const sampleR = inputR[i] ?? 0;
      sumL += sampleL * sampleL;
      sumR += sampleR * sampleR;
    }

    // Block RMS
    const blockRmsL = Math.sqrt(sumL / blockSize);
    const blockRmsR = Math.sqrt(sumR / blockSize);

    // Apply smoothing (exponential moving average)
    this.currentRmsL =
      this.smoothingFactor * this.currentRmsL +
      (1 - this.smoothingFactor) * blockRmsL;
    this.currentRmsR =
      this.smoothingFactor * this.currentRmsR +
      (1 - this.smoothingFactor) * blockRmsR;
  }

  /**
   * Get current RMS levels in dB
   */
  getLevelsDb(): { left: number; right: number } {
    return {
      left: this.linearToDb(this.currentRmsL),
      right: this.linearToDb(this.currentRmsR),
    };
  }

  /**
   * Get current RMS levels as linear values (0-1 normalized)
   */
  getLevelsLinear(): { left: number; right: number } {
    return {
      left: this.currentRmsL,
      right: this.currentRmsR,
    };
  }

  /**
   * Get current RMS levels as normalized 0-1 values
   * (mapped from minDb to 0dB)
   */
  getLevelsNormalized(): { left: number; right: number } {
    const dbL = this.linearToDb(this.currentRmsL);
    const dbR = this.linearToDb(this.currentRmsR);

    return {
      left: Math.max(0, Math.min(1, (dbL - this.minDb) / -this.minDb)),
      right: Math.max(0, Math.min(1, (dbR - this.minDb) / -this.minDb)),
    };
  }

  /**
   * Reset meter to initial state
   */
  reset(): void {
    this.currentRmsL = 0;
    this.currentRmsR = 0;
  }

  private linearToDb(linear: number): number {
    if (linear < 1e-10) {
      return this.minDb;
    }
    return Math.max(this.minDb, 20 * Math.log10(linear));
  }
}
