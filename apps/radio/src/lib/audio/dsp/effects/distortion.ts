/**
 * Distortion Effect
 *
 * Implements a distortion curve similar to WaveShaperNode.
 */

export class Distortion {
  private amount = 0;
  private curve: Float32Array | null = null;
  private readonly curveSamples = 44_100;

  constructor(_sampleRate: number) {
    this.updateCurve();
  }

  setAmount(value: number): void {
    this.amount = Math.max(0, Math.min(1, value));
    this.updateCurve();
  }

  getAmount(): number {
    return this.amount;
  }

  private updateCurve(): void {
    const curve = new Float32Array(this.curveSamples);
    const deg = Math.PI / 180;
    const k = this.amount * 2;

    for (let i = 0; i < this.curveSamples; i++) {
      const x = (i * 2) / this.curveSamples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }

    this.curve = curve;
  }

  private applyCurve(value: number): number {
    if (!this.curve) {
      return value;
    }

    // Map input value [-1, 1] to curve index [0, curveSamples-1]
    const normalized = (value + 1) / 2;
    const index = Math.max(
      0,
      Math.min(
        this.curveSamples - 1,
        Math.floor(normalized * this.curveSamples)
      )
    );

    return this.curve[index] ?? value;
  }

  reset(): void {
    // No state to reset for distortion
  }

  process(
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: number,
    toIndex: number
  ): void {
    if (this.amount === 0) {
      // No distortion - pass through
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = inputL[i] ?? 0;
        outputR[i] = inputR[i] ?? 0;
      }
      return;
    }

    for (let i = fromIndex; i < toIndex; i++) {
      outputL[i] = this.applyCurve(inputL[i] ?? 0);
      outputR[i] = this.applyCurve(inputR[i] ?? 0);
    }
  }
}
