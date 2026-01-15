import { BasePlayback } from "./base-playback.js";
import type { BaseSound } from "./cacophony.js";
import type {
  AudioContext,
} from "./context.js";
import type { CacophonyEngine } from "./engine/cacophony-engine.js";
import type { OscillatorType } from "./protocol.js";
import type { Synth } from "./synth.js";

const SynthPlaybackBase = BasePlayback;


const PlaybackState = {
  Unplayed: 0,
  Playing: 1,
  Paused: 2,
  Stopped: 3,
} as const;

type PlaybackState = (typeof PlaybackState)[keyof typeof PlaybackState];

/**
 * SynthPlayback handles audio playback for oscillator-based sounds.
 * Supports two modes:
 * 1. Legacy: Uses Web Audio OscillatorNode directly
 * 2. Engine: Uses CacophonyEngine with AudioWorklet-based OscillatorSource
 */
export class SynthPlayback extends SynthPlaybackBase implements BaseSound {
  context: AudioContext;
  origin: Synth;
  
  // Engine-based playback fields
  private sourceId: string;
  private engine: CacophonyEngine;
  private _state: PlaybackState = PlaybackState.Unplayed;
  
  /**
   * Creates an instance of SynthPlayback.
   * Engine-only mode: (origin, sourceId, engine)
   */
  constructor(origin: Synth, sourceId: string, engine: CacophonyEngine) {
    super();
    this.context = origin.context;
    this.origin = origin;
    this.setPanType(origin.panType, origin.context);
    
    this.sourceId = sourceId;
    this.engine = engine;
    
    // Set initial oscillator parameters via engine
    if (origin.oscillatorOptions.frequency !== undefined) {
      this.engine.setOscillatorFrequency(this.sourceId, origin.oscillatorOptions.frequency);
    }
    if (origin.oscillatorOptions.detune !== undefined) {
      this.engine.setOscillatorDetune(this.sourceId, origin.oscillatorOptions.detune);
    }
    if (origin.oscillatorOptions.type !== undefined) {
      // Only send if it's a supported type (exclude 'custom')
      const type = origin.oscillatorOptions.type;
      if (type !== 'custom') {
        this.engine.setOscillatorType(this.sourceId, type);
      }
    }
    
    // Apply volume/pan
    this.engine.setSourceVolume(this.sourceId, origin.volume);
    if (origin.stereoPan !== undefined && origin.stereoPan !== null) {
      this.engine.setSourcePan(this.sourceId, origin.stereoPan);
    }
  }

  get isPlaying(): boolean {
    return this._state === PlaybackState.Playing;
  }

  play(): [this] {
    if (this._state === PlaybackState.Playing) {
      return [this];
    }

    try {
      // Ensure AudioContext is resumed
      if (this.context.state === "suspended") {
        this.context.resume().catch((error) => {
          console.warn("Failed to resume AudioContext:", error);
        });
      }

      if (this._state === PlaybackState.Paused) {
        this.engine.resumeSource(this.sourceId);
      } else {
        this.engine.startSource(this.sourceId);
      }

      this._state = PlaybackState.Playing;
      this.emit("play", this);
      return [this];
    } catch (error) {
      this.emitAsync("error", {
        error: error as Error,
        errorType: "source",
        timestamp: Date.now(),
        recoverable: true,
      });
      throw error;
    }
  }

  pause(): void {
    if (this._state !== PlaybackState.Playing) {
      return;
    }
    
    this.engine.pauseSource(this.sourceId);
    this._state = PlaybackState.Paused;
    this.emit("pause", undefined);
  }

  stop(): void {
    if (this._state === PlaybackState.Stopped || this._state === PlaybackState.Unplayed) {
      return;
    }

    this.engine.stopSource(this.sourceId);
    this._state = PlaybackState.Stopped;
    this.emit("stop", undefined);
  }

  // Oscillator parameter getters/setters with engine support
  get frequency(): number {
    return (this.origin.oscillatorOptions.frequency as number) || 440;
  }

  set frequency(value: number) {
    this.engine.setOscillatorFrequency(this.sourceId, value);
  }

  get detune(): number {
    return (this.origin.oscillatorOptions.detune as number) || 0;
  }

  set detune(value: number) {
    this.engine.setOscillatorDetune(this.sourceId, value);
  }

  get type(): OscillatorType | "custom" {
    return (this.origin.oscillatorOptions.type as OscillatorType | "custom") || "sine";
  }

  set type(value: OscillatorType | "custom") {
    // Only send if it's a supported type (exclude 'custom')
    if (value !== 'custom') {
      this.engine.setOscillatorType(this.sourceId, value);
    }
  }

  // Volume override with engine support
  get volume(): number {
    return (this as any)._volume ?? 1;
  }

  set volume(v: number) {
    (this as any)._volume = v;
    this.engine.setSourceVolume(this.sourceId, v);
  }

  // Pan override with engine support
  get stereoPan(): number | null {
    return (this as any)._pan ?? 0;
  }

  set stereoPan(v: number) {
    (this as any)._pan = v;
    this.engine.setSourcePan(this.sourceId, v);
  }

  /**
   * Refreshes the audio filters by re-applying them to the audio signal chain.
   */
  private refreshFilters(): void {
    // No-op in engine mode until filters are ported
    return;
  }

  cleanup(): void {
    // Engine mode - just stop the source
    if (this.engine && this.sourceId && this._state === PlaybackState.Playing) {
      this.engine.stopSource(this.sourceId);
    }
    // @ts-ignore
    this.sourceId = undefined;
    // @ts-ignore
    this.engine = undefined;
    super.cleanup();
  }
}
