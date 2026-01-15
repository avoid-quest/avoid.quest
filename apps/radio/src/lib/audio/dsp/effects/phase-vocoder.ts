/**
 * Phase Vocoder Effect
 *
 * Simplified pitch shifting using linear interpolation.
 * Note: This is a placeholder that needs proper FFT/OLA implementation.
 */

export class PhaseVocoder {
  private pitchFactor = 1.0;

  // Buffer for resampling
  private readonly bufferSize = 4096;
  private readonly bufferL: Float32Array;
  private readonly bufferR: Float32Array;
  private readPosition = 0;
  private writePosition = 0;

  constructor(_sampleRate: number) {
    this.bufferL = new Float32Array(this.bufferSize);
    this.bufferR = new Float32Array(this.bufferSize);
  }

  setPitchFactor(value: number): void {
    this.pitchFactor = Math.max(0.25, Math.min(4.0, value));
  }

  reset(): void {
    this.bufferL.fill(0);
    this.bufferR.fill(0);
    this.readPosition = 0;
    this.writePosition = 0;
  }

  process(
    input: [Float32Array, Float32Array],
    output: [Float32Array, Float32Array],
    fromIndex: number,
    toIndex: number
  ): void {
    const [inputL, inputR] = input;
    const [outputL, outputR] = output;

    // If pitch factor is 1.0, pass through
    if (Math.abs(this.pitchFactor - 1.0) < 0.001) {
      for (let i = fromIndex; i < toIndex; i++) {
        outputL[i] = inputL[i] ?? 0;
        outputR[i] = inputR[i] ?? 0;
      }
      return;
    }

    // Simple resampling-based pitch shift (basic implementation)
    // Write input to buffer
    for (let i = fromIndex; i < toIndex; i++) {
      this.bufferL[this.writePosition] = inputL[i] ?? 0;
      this.bufferR[this.writePosition] = inputR[i] ?? 0;
      this.writePosition = (this.writePosition + 1) & (this.bufferSize - 1);
    }

    // Read from buffer with pitch-shifted rate
    const step = this.pitchFactor;

    for (let i = fromIndex; i < toIndex; i++) {
      const pos = this.readPosition;
      const posInt = Math.floor(pos);
      const posFrac = pos - posInt;

      // Linear interpolation
      const idx0 = posInt & (this.bufferSize - 1);
      const idx1 = (posInt + 1) & (this.bufferSize - 1);

      const sampleL0 = this.bufferL[idx0] ?? 0;
      const sampleL1 = this.bufferL[idx1] ?? 0;
      const sampleR0 = this.bufferR[idx0] ?? 0;
      const sampleR1 = this.bufferR[idx1] ?? 0;

      outputL[i] = sampleL0 + (sampleL1 - sampleL0) * posFrac;
      outputR[i] = sampleR0 + (sampleR1 - sampleR0) * posFrac;

      this.readPosition += step;

      // Keep read position in bounds
      while (this.readPosition >= this.bufferSize) {
        this.readPosition -= this.bufferSize;
      }
    }
  }
}
