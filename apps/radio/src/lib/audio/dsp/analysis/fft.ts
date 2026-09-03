/**
 * FFT Spectrum Analyzer
 *
 * Simple FFT implementation for spectrum visualization.
 * Uses a basic radix-2 Cooley-Tukey algorithm.
 */

export class FFTAnalyzer {
  private readonly fftSize: number;
  private readonly realBuffer: Float32Array;
  private readonly imagBuffer: Float32Array;
  private readonly magnitudeBuffer: Float32Array;
  private readonly windowBuffer: Float32Array;
  private readonly minDb: number;
  private readonly maxDb: number;

  /**
   * Create an FFT analyzer
   * @param fftSize FFT size (must be power of 2, default 2048)
   * @param minDb Minimum dB for normalization (default -100)
   * @param maxDb Maximum dB for normalization (default 0)
   */
  constructor(fftSize = 2048, minDb = -100, maxDb = 0) {
    // Ensure power of 2
    const log2 = Math.log2(fftSize);
    if (log2 !== Math.floor(log2)) {
      throw new Error("FFT size must be a power of 2");
    }

    this.fftSize = fftSize;
    this.realBuffer = new Float32Array(fftSize);
    this.imagBuffer = new Float32Array(fftSize);
    this.magnitudeBuffer = new Float32Array(fftSize / 2);
    this.windowBuffer = this.createHannWindow(fftSize);
    this.minDb = minDb;
    this.maxDb = maxDb;
  }

  /**
   * Get FFT size
   */
  get size(): number {
    return this.fftSize;
  }

  /**
   * Get number of frequency bins (fftSize / 2)
   */
  get binCount(): number {
    return this.fftSize / 2;
  }

  /**
   * Get frequency for a given bin
   */
  getFrequencyForBin(bin: number, sampleRate: number): number {
    return (bin * sampleRate) / this.fftSize;
  }

  /**
   * Analyze a mono signal and compute magnitude spectrum
   */
  analyze(input: Float32Array, fromIndex = 0): Float32Array {
    // Copy input with window function
    for (let i = 0; i < this.fftSize; i++) {
      this.realBuffer[i] = (input[fromIndex + i] ?? 0) * this.windowBuffer[i];
      this.imagBuffer[i] = 0;
    }

    // Perform FFT
    this.fft(this.realBuffer, this.imagBuffer);

    // Calculate magnitudes (only first half - positive frequencies)
    for (let i = 0; i < this.fftSize / 2; i++) {
      const real = this.realBuffer[i] ?? 0;
      const imag = this.imagBuffer[i] ?? 0;
      const magnitude = Math.sqrt(real * real + imag * imag);
      this.magnitudeBuffer[i] = magnitude;
    }

    return this.magnitudeBuffer;
  }

  /**
   * Get magnitude spectrum in dB, normalized to 0-1 range
   */
  getMagnitudesNormalized(): Float32Array {
    const normalized = new Float32Array(this.binCount);
    const range = this.maxDb - this.minDb;

    for (let i = 0; i < this.binCount; i++) {
      const magnitude = this.magnitudeBuffer[i] ?? 0;
      const db = magnitude > 1e-10 ? 20 * Math.log10(magnitude) : this.minDb;
      normalized[i] = Math.max(0, Math.min(1, (db - this.minDb) / range));
    }

    return normalized;
  }

  /**
   * Get magnitude spectrum in dB
   */
  getMagnitudesDb(): Float32Array {
    const dbBuffer = new Float32Array(this.binCount);

    for (let i = 0; i < this.binCount; i++) {
      const magnitude = this.magnitudeBuffer[i] ?? 0;
      dbBuffer[i] =
        magnitude > 1e-10
          ? Math.max(this.minDb, 20 * Math.log10(magnitude))
          : this.minDb;
    }

    return dbBuffer;
  }

  /**
   * Create Hann window for FFT
   */
  private createHannWindow(size: number): Float32Array {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return window;
  }

  /**
   * In-place Cooley-Tukey FFT
   */
  private fft(real: Float32Array, imag: Float32Array): void {
    const n = real.length;
    const levels = Math.log2(n);

    // Bit-reversal permutation
    for (let i = 0; i < n; i++) {
      const j = this.reverseBits(i, levels);
      if (j > i) {
        // Swap real
        const tempReal = real[i] ?? 0;
        real[i] = real[j] ?? 0;
        real[j] = tempReal;
        // Swap imag
        const tempImag = imag[i] ?? 0;
        imag[i] = imag[j] ?? 0;
        imag[j] = tempImag;
      }
    }

    // Cooley-Tukey iterative FFT
    for (let size = 2; size <= n; size *= 2) {
      const halfSize = size / 2;
      const tableStep = n / size;

      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + halfSize; j++, k += tableStep) {
          const l = j + halfSize;
          const angle = (-2 * Math.PI * k) / n;
          const tpReal = Math.cos(angle);
          const tpImag = Math.sin(angle);

          const realL = real[l] ?? 0;
          const imagL = imag[l] ?? 0;
          const trReal = realL * tpReal - imagL * tpImag;
          const trImag = realL * tpImag + imagL * tpReal;

          const realJ = real[j] ?? 0;
          const imagJ = imag[j] ?? 0;
          real[l] = realJ - trReal;
          imag[l] = imagJ - trImag;
          real[j] = realJ + trReal;
          imag[j] = imagJ + trImag;
        }
      }
    }
  }

  /**
   * Reverse bits for bit-reversal permutation
   */
  private reverseBits(input: number, bits: number): number {
    let result = 0;
    let value = input;
    for (let i = 0; i < bits; i++) {
      result = (result << 1) | (value & 1);
      value >>>= 1;
    }
    return result;
  }
}
