/**
 * Distortion Effect
 *
 * Soft-clipping distortion using atan waveshaping.
 * Drive ranges from subtle warmth to heavy saturation.
 * Includes auto gain compensation to maintain consistent volume.
 */

export class Distortion {
  // Drive multiplier (1 = clean, 50 = heavy distortion)
  private drive = 1;
  // Auto gain compensation (reduces output as drive increases)
  private makeup = 1;

  /**
   * Set distortion amount (0-100 scale)
   */
  setAmount(value: number): void {
    // Map 0-100 to drive range: 1 (clean) to 50 (heavy)
    const normalized = Math.max(0, Math.min(100, value)) / 100;
    // Exponential curve for more musical response
    this.drive = 1 + normalized * normalized * 49;

    // Auto gain compensation: reduce output as drive increases
    // At drive=1: makeup=1 (no change)
    // At drive=50: makeup≈0.3 (significant reduction)
    this.makeup = 1 / Math.sqrt(this.drive);
  }

  getAmount(): number {
    return ((this.drive - 1) / 99) * 100;
  }

  reset(): void {
    // No state to reset
  }

  process(
    input: [Float32Array, Float32Array],
    output: [Float32Array, Float32Array],
    fromIndex: number,
    toIndex: number
  ): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;

    if (this.drive <= 1) {
      // No distortion - pass through
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = inputL[i] ?? 0;
        outputR[i] = inputR[i] ?? 0;
      }
      return;
    }

    const inv = (2 / Math.PI) * this.makeup;
    for (let i = fromIndex; i < toIndex; i++) {
      outputL[i] = inv * Math.atan(this.drive * (inputL[i] ?? 0));
      outputR[i] = inv * Math.atan(this.drive * (inputR[i] ?? 0));
    }
  }
}
