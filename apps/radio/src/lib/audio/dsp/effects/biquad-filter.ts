/**
 * BiquadFilter processor for the AudioWorklet.
 *
 * Implements standard biquad filter types using Robert Bristow-Johnson's
 * Audio EQ Cookbook formulas.
 *
 * Supports: lowpass, highpass, bandpass, lowshelf, highshelf, peaking, notch, allpass
 */

export type BiquadFilterType =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "lowshelf"
  | "highshelf"
  | "peaking"
  | "notch"
  | "allpass";

export type BiquadFilterParams = {
  type: BiquadFilterType;
  frequency: number; // Hz
  Q: number; // Quality factor
  gain: number; // dB (for shelving/peaking filters)
};

/**
 * BiquadFilter implements a second-order IIR filter.
 *
 * Uses Direct Form II Transposed for numerical stability.
 */
export class BiquadFilter {
  // Coefficients (used via destructuring in process())
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;

  // State variables for stereo (used via destructuring in process())
  private z1L = 0;
  private z2L = 0;
  private z1R = 0;
  private z2R = 0;

  // Parameters
  private _type: BiquadFilterType = "lowpass";
  private _frequency = 350;
  private _Q = 1;
  private _gain = 0;
  private readonly sampleRate: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.updateCoefficients();
  }

  get type(): BiquadFilterType {
    return this._type;
  }
  set type(value: BiquadFilterType) {
    this._type = value;
    this.updateCoefficients();
  }

  get frequency(): number {
    return this._frequency;
  }
  set frequency(value: number) {
    this._frequency = Math.max(10, Math.min(value, this.sampleRate / 2 - 1));
    this.updateCoefficients();
  }

  get Q(): number {
    return this._Q;
  }
  set Q(value: number) {
    this._Q = Math.max(0.001, value);
    this.updateCoefficients();
  }

  get gain(): number {
    return this._gain;
  }
  set gain(value: number) {
    this._gain = value;
    this.updateCoefficients();
  }

  /**
   * Update filter coefficients based on current parameters.
   * Uses Audio EQ Cookbook formulas.
   */
  private updateCoefficients(): void {
    const w0 = (2 * Math.PI * this._frequency) / this.sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * this._Q);
    const A = 10 ** (this._gain / 40); // sqrt of linear gain

    let b0: number;
    let b1: number;
    let b2: number;
    let a0: number;
    let a1: number;
    let a2: number;

    switch (this._type) {
      case "lowpass":
        b0 = (1 - cosW0) / 2;
        b1 = 1 - cosW0;
        b2 = (1 - cosW0) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosW0;
        a2 = 1 - alpha;
        break;

      case "highpass":
        b0 = (1 + cosW0) / 2;
        b1 = -(1 + cosW0);
        b2 = (1 + cosW0) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosW0;
        a2 = 1 - alpha;
        break;

      case "bandpass":
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cosW0;
        a2 = 1 - alpha;
        break;

      case "notch":
        b0 = 1;
        b1 = -2 * cosW0;
        b2 = 1;
        a0 = 1 + alpha;
        a1 = -2 * cosW0;
        a2 = 1 - alpha;
        break;

      case "allpass":
        b0 = 1 - alpha;
        b1 = -2 * cosW0;
        b2 = 1 + alpha;
        a0 = 1 + alpha;
        a1 = -2 * cosW0;
        a2 = 1 - alpha;
        break;

      case "peaking":
        b0 = 1 + alpha * A;
        b1 = -2 * cosW0;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cosW0;
        a2 = 1 - alpha / A;
        break;

      case "lowshelf": {
        const sqrtA = Math.sqrt(A);
        const sqrtA2alpha = 2 * sqrtA * alpha;
        b0 = A * (A + 1 - (A - 1) * cosW0 + sqrtA2alpha);
        b1 = 2 * A * (A - 1 - (A + 1) * cosW0);
        b2 = A * (A + 1 - (A - 1) * cosW0 - sqrtA2alpha);
        a0 = A + 1 + (A - 1) * cosW0 + sqrtA2alpha;
        a1 = -2 * (A - 1 + (A + 1) * cosW0);
        a2 = A + 1 + (A - 1) * cosW0 - sqrtA2alpha;
        break;
      }

      case "highshelf": {
        const sqrtA = Math.sqrt(A);
        const sqrtA2alpha = 2 * sqrtA * alpha;
        b0 = A * (A + 1 + (A - 1) * cosW0 + sqrtA2alpha);
        b1 = -2 * A * (A - 1 + (A + 1) * cosW0);
        b2 = A * (A + 1 + (A - 1) * cosW0 - sqrtA2alpha);
        a0 = A + 1 - (A - 1) * cosW0 + sqrtA2alpha;
        a1 = 2 * (A - 1 - (A + 1) * cosW0);
        a2 = A + 1 - (A - 1) * cosW0 - sqrtA2alpha;
        break;
      }

      default:
        // Bypass
        b0 = 1;
        b1 = 0;
        b2 = 0;
        a0 = 1;
        a1 = 0;
        a2 = 0;
    }

    // Normalize coefficients
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  /**
   * Process audio through the filter.
   * Uses Direct Form II Transposed for better numerical stability.
   */
  process(
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: number,
    toIndex: number
  ): void {
    const { b0, b1, b2, a1, a2 } = this;
    let { z1L, z2L, z1R, z2R } = this;

    for (let i = fromIndex; i < toIndex; i++) {
      // Left channel
      const xL = inputL[i] ?? 0;
      const yL = b0 * xL + z1L;
      z1L = b1 * xL - a1 * yL + z2L;
      z2L = b2 * xL - a2 * yL;
      outputL[i] = yL;

      // Right channel
      const xR = inputR[i] ?? 0;
      const yR = b0 * xR + z1R;
      z1R = b1 * xR - a1 * yR + z2R;
      z2R = b2 * xR - a2 * yR;
      outputR[i] = yR;
    }

    // Store state
    this.z1L = z1L;
    this.z2L = z2L;
    this.z1R = z1R;
    this.z2R = z2R;
  }

  /**
   * Reset filter state (e.g., when stopping playback)
   */
  reset(): void {
    this.z1L = 0;
    this.z2L = 0;
    this.z1R = 0;
    this.z2R = 0;
  }
}
