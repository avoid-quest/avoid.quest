import { type int } from "@opendaw/lib-std";
import { Source } from "./source.js";

export type OscillatorType = "sine" | "sawtooth" | "square" | "triangle";

/**
 * OscillatorSource generates audio from basic waveforms within the AudioWorklet.
 * Supports sine, sawtooth, square, and triangle waves with frequency, detune, and type control.
 */
export class OscillatorSource extends Source {
  private phase: number = 0;
  private _frequency: number = 440;
  private _detune: number = 0;
  private _type: OscillatorType = "sine";
  private isPlaying: boolean = false;
  private isPaused: boolean = false;

  // Volume and pan for per-source control (inherited pattern from BufferSource)
  volume = 1.0;
  pan = 0.0; // -1 (left) to 1 (right)

  // Internal buffers
  private tempL: Float32Array | null = null;
  private tempR: Float32Array | null = null;

  constructor(options: {
    frequency?: number;
    detune?: number;
    type?: OscillatorType;
  } = {}) {
    super();
    this._frequency = options.frequency ?? 440;
    this._detune = options.detune ?? 0;
    this._type = options.type ?? "sine";
  }

  // Lifecycle methods
  start() {
    this.isPlaying = true;
    this.isPaused = false;
    // Don't reset phase to allow smooth restarts
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this.phase = 0;
    // Reset filters
    for (const filter of this.filters.values()) filter.reset();
  }

  pause() {
    if (this.isPlaying && !this.isPaused) {
      this.isPaused = true;
    }
  }

  resume() {
    if (this.isPaused) {
      this.isPaused = false;
    }
  }

  // Frequency control
  get frequency(): number {
    return this._frequency;
  }

  set frequency(value: number) {
    this._frequency = Math.max(0, value);
  }

  // Detune control (in cents)
  get detune(): number {
    return this._detune;
  }

  set detune(value: number) {
    this._detune = value;
  }

  // Oscillator type
  get type(): OscillatorType {
    return this._type;
  }

  set type(value: OscillatorType) {
    this._type = value;
  }

  /**
   * Calculate effective frequency including detune
   */
  private getEffectiveFrequency(): number {
    // Detune is in cents: 100 cents = 1 semitone, 1200 cents = 1 octave
    const detuneMultiplier = Math.pow(2, this._detune / 1200);
    return this._frequency * detuneMultiplier;
  }

  /**
   * Generate waveform sample at current phase
   */
  private generateSample(phase: number): number {
    switch (this._type) {
      case "sine":
        return Math.sin(phase * 2 * Math.PI);
      
      case "sawtooth":
        // Sawtooth: goes from -1 to 1 linearly
        return 2 * (phase - Math.floor(phase + 0.5));
      
      case "square":
        // Square: -1 for first half, 1 for second half
        return phase % 1 < 0.5 ? 1 : -1;
      
      case "triangle":
        // Triangle: goes up from -1 to 1, then down from 1 to -1
        const t = phase % 1;
        return 4 * Math.abs(t - 0.5) - 1;
      
      default:
        return 0;
    }
  }

  process(
    outputL: Float32Array,
    outputR: Float32Array,
    fromIndex: int,
    toIndex: int
  ): boolean {
    // If paused, stay active but don't produce audio
    if (this.isPaused) return true;
    
    // If not playing, source is finished
    if (!this.isPlaying) return false;
    
    if (!outputL || !outputR) return false;

    // Initialize temp buffers if needed
    if (!this.tempL || this.tempL.length < outputL.length) {
      this.tempL = new Float32Array(outputL.length);
      this.tempR = new Float32Array(outputR.length);
    }
    
    // Clear temp buffers for this block
    this.tempL!.fill(0, fromIndex, toIndex);
    this.tempR!.fill(0, fromIndex, toIndex);

    const sampleRate = globalThis.sampleRate || 44100;
    const effectiveFrequency = this.getEffectiveFrequency();
    const phaseIncrement = effectiveFrequency / sampleRate;

    // Generate audio into temp buffers
    for (let i = fromIndex; i < toIndex; i++) {
      const sample = this.generateSample(this.phase);
      
      this.tempL![i] = sample;
      this.tempR![i] = sample;

      // Advance phase, keep it in [0, 1) range
      this.phase = (this.phase + phaseIncrement) % 1;
    }

    // Apply filters
    this.applyFilters(this.tempL!, this.tempR!, fromIndex, toIndex);

    // Calculate pan gains (simple linear balance)
    let gainL = this.volume;
    let gainR = this.volume;
    
    if (this.pan < 0) {
      gainR *= (1 + this.pan); // Pan left: reduce right
    } else if (this.pan > 0) {
      gainL *= (1 - this.pan); // Pan right: reduce left
    }

    // Mix to output
    for (let i = fromIndex; i < toIndex; i++) {
        outputL[i]! += this.tempL![i]! * gainL;
        outputR[i]! += this.tempR![i]! * gainR;
    }

    return true;
  }
}
