/**
 * Spectrum Analyzer
 *
 * Wraps openDAW's AudioAnalyser for FFT-based spectrum analysis.
 * Provides frequency bins and waveform data for visualizations.
 */

import { AudioAnalyser } from "@opendaw/lib-dsp";

export class SpectrumAnalyzer {
  private readonly analyser: AudioAnalyser;

  constructor(size = 512) {
    this.analyser = new AudioAnalyser({ size, decay: 0.95 }); // Enable smooth decay for better visuals
  }

  /**
   * Process stereo audio samples
   */
  process(
    left: Float32Array,
    right: Float32Array,
    fromIndex: number,
    toIndex: number
  ): void {
    this.analyser.process(left, right, fromIndex, toIndex);
  }

  /**
   * Get frequency bins (FFT magnitude data)
   * Values are in dB scale, suitable for visualization
   */
  getBins(): Float32Array {
    return this.analyser.bins();
  }

  /**
   * Get waveform data (time-domain samples)
   * Useful for oscilloscope-style display
   */
  getWaveform(): Float32Array {
    return this.analyser.waveform();
  }

  /**
   * Get number of frequency bins
   */
  getNumBins(): number {
    return this.analyser.numBins();
  }

  /**
   * Clear analysis buffers
   */
  clear(): void {
    this.analyser.clear();
  }

  /**
   * Reset analyzer state
   */
  reset(): void {
    this.analyser.reset();
  }
}
