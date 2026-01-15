/**
 * Dynamics Compressor Effect
 *
 * Implements a simplified compressor algorithm similar to DynamicsCompressorNode.
 *
 * TODO: Upgrade to use CTAGDRC components from @opendaw/lib-dsp/ctagdrc
 * (GainComputer, LevelDetector, LookAhead, DelayLine, SmoothingFilter)
 * This requires API documentation to determine correct constructor arguments and usage.
 */

export class Compressor {
  private threshold = -24; // dB
  private ratio = 12;
  private attack = 0.003; // seconds
  private release = 0.25; // seconds
  private knee = 30; // dB
  private readonly sampleRate: number;

  // Internal state
  private gainReduction = 1;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  setThreshold(value: number): void {
    this.threshold = value; // dB
  }

  setRatio(value: number): void {
    this.ratio = Math.max(1, value);
  }

  setAttack(value: number): void {
    this.attack = Math.max(0, value);
  }

  setRelease(value: number): void {
    this.release = Math.max(0, value);
  }

  setKnee(value: number): void {
    this.knee = Math.max(0, value);
  }

  reset(): void {
    this.gainReduction = 1;
  }

  private dbToLinear(db: number): number {
    return 10 ** (db / 20);
  }

  private linearToDb(linear: number): number {
    return 20 * Math.log10(Math.max(1e-10, Math.abs(linear)));
  }

  private computeGainReduction(inputLevelDb: number): number {
    const thresholdDb = this.threshold;
    const overThreshold = inputLevelDb - thresholdDb;

    if (overThreshold <= 0) {
      return 1; // No compression
    }

    // Soft knee
    const kneeStart = thresholdDb - this.knee / 2;
    const kneeEnd = thresholdDb + this.knee / 2;

    let compressionRatio: number;
    if (inputLevelDb < kneeStart) {
      compressionRatio = 1; // No compression
    } else if (inputLevelDb < kneeEnd) {
      // Soft knee region - gradual compression
      const kneeRatio = (inputLevelDb - kneeStart) / this.knee;
      compressionRatio = 1 + (this.ratio - 1) * kneeRatio;
    } else {
      // Full compression
      compressionRatio = this.ratio;
    }

    // Calculate gain reduction
    const compressedLevel = thresholdDb + overThreshold / compressionRatio;
    const gainReductionDb = inputLevelDb - compressedLevel;
    return this.dbToLinear(-gainReductionDb);
  }

  process(
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: number,
    toIndex: number
  ): void {
    const attackCoeff = Math.exp(-1 / (this.attack * this.sampleRate));
    const releaseCoeff = Math.exp(-1 / (this.release * this.sampleRate));

    for (let i = fromIndex; i < toIndex; i++) {
      const sampleL = inputL[i] ?? 0;
      const sampleR = inputR[i] ?? 0;

      // Calculate input level (RMS of both channels)
      const rms = Math.sqrt((sampleL * sampleL + sampleR * sampleR) / 2);
      const levelDb = this.linearToDb(rms);

      // Update envelope with attack/release
      const targetGain = this.computeGainReduction(levelDb);

      if (targetGain < this.gainReduction) {
        // Attack
        this.gainReduction =
          targetGain + (this.gainReduction - targetGain) * attackCoeff;
      } else {
        // Release
        this.gainReduction =
          targetGain + (this.gainReduction - targetGain) * releaseCoeff;
      }

      // Apply gain reduction
      outputL[i] = sampleL * this.gainReduction;
      outputR[i] = sampleR * this.gainReduction;
    }
  }
}
