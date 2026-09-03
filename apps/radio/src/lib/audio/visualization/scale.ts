/**
 * Scale Utilities for Audio Visualization
 *
 * Linear and logarithmic scales for frequency/gain mapping.
 */

export class LinearScale {
  readonly min: number;
  readonly max: number;
  readonly rangeMin: number;
  readonly rangeMax: number;

  constructor(min: number, max: number, rangeMin: number, rangeMax: number) {
    this.min = min;
    this.max = max;
    this.rangeMin = rangeMin;
    this.rangeMax = rangeMax;
  }

  /** Map a value to the output range */
  scale(value: number): number {
    const t = (value - this.min) / (this.max - this.min);
    return this.rangeMin + t * (this.rangeMax - this.rangeMin);
  }

  /** Inverse: map from output range back to value */
  invert(pixel: number): number {
    const t = (pixel - this.rangeMin) / (this.rangeMax - this.rangeMin);
    return this.min + t * (this.max - this.min);
  }
}

export class LogScale {
  readonly min: number;
  readonly max: number;
  readonly rangeMin: number;
  readonly rangeMax: number;
  private readonly logMin: number;
  private readonly logMax: number;

  constructor(min: number, max: number, rangeMin: number, rangeMax: number) {
    this.min = min;
    this.max = max;
    this.rangeMin = rangeMin;
    this.rangeMax = rangeMax;
    this.logMin = Math.log10(Math.max(min, 1));
    this.logMax = Math.log10(max);
  }

  /** Map a value to the output range using log scale */
  scale(value: number): number {
    const logValue = Math.log10(Math.max(value, 1));
    const t = (logValue - this.logMin) / (this.logMax - this.logMin);
    return this.rangeMin + t * (this.rangeMax - this.rangeMin);
  }

  /** Inverse: map from output range back to value */
  invert(pixel: number): number {
    const t = (pixel - this.rangeMin) / (this.rangeMax - this.rangeMin);
    const logValue = this.logMin + t * (this.logMax - this.logMin);
    return 10 ** logValue;
  }
}

/**
 * Generate logarithmically spaced frequency points for EQ curves.
 * Creates frequencies from min to max Hz with numPoints samples.
 */
export function generateLogFrequencies(
  minHz: number,
  maxHz: number,
  numPoints: number
): Float32Array {
  const frequencies = new Float32Array(numPoints);
  const logMin = Math.log10(minHz);
  const logMax = Math.log10(maxHz);

  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    const logFreq = logMin + t * (logMax - logMin);
    frequencies[i] = 10 ** logFreq;
  }

  return frequencies;
}

/**
 * Generate frequency points normalized to sample rate (0-0.5).
 * This is the format used by biquad coefficient calculations.
 */
export function generateNormalizedFrequencies(
  minHz: number,
  maxHz: number,
  numPoints: number,
  sampleRate: number
): Float32Array {
  const frequencies = new Float32Array(numPoints);
  const logMin = Math.log10(minHz);
  const logMax = Math.log10(Math.min(maxHz, sampleRate / 2));

  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    const logFreq = logMin + t * (logMax - logMin);
    frequencies[i] = 10 ** logFreq / sampleRate;
  }

  return frequencies;
}
