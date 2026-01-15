import {
  type BaseSound,
  type Cacophony,
  type PanType,
  SoundType,
} from "./cacophony.js";
import { PlaybackContainer } from "./container.js";
import type { AudioContext, GainNode, OscillatorNode } from "./context.js";
import type { CacophonyEngine } from "./engine/cacophony-engine.js";
import { TypedEventEmitter } from "./eventEmitter.js";
import type { SynthEvents } from "./events.js";
import type { FilterCloneOverrides } from "./filters.js";
import { FilterManager } from "./filters.js";
import type { PanCloneOverrides } from "./panner-mixin.js";
import { SynthPlayback } from "./synth-playback.js";
import type { VolumeCloneOverrides } from "./volume-mixin.js";

type OscillatorCloneOverrides = {
  oscillatorOptions?: Partial<OscillatorOptions>;
};

type SynthCloneOverrides = FilterCloneOverrides &
  OscillatorCloneOverrides &
  PanCloneOverrides &
  VolumeCloneOverrides;

type SynthOptions = {
  context: AudioContext;
  soundType?: SoundType;
  panType?: PanType;
  oscillatorOptions?: Partial<OscillatorOptions>;
  cacophony?: Cacophony;
};

export class Synth
  extends PlaybackContainer(FilterManager)
  implements BaseSound
{
  _oscillatorOptions: Partial<OscillatorOptions>;
  playbacks: SynthPlayback[] = [];
  private readonly eventEmitter: TypedEventEmitter<SynthEvents> =
    new TypedEventEmitter<SynthEvents>();

  /**
   * Register event listener.
   * @returns Cleanup function
   */
  on<K extends keyof SynthEvents>(
    event: K,
    listener: (data: SynthEvents[K]) => void
  ): void {
    this.eventEmitter.on(event, listener);
  }

  /**
   * Remove event listener.
   */
  off<K extends keyof SynthEvents>(
    event: K,
    listener: (data: SynthEvents[K]) => void
  ): void {
    this.eventEmitter.off(event, listener);
  }

  protected emit<K extends keyof SynthEvents>(
    event: K,
    data: SynthEvents[K]
  ): void {
    this.eventEmitter.emit(event, data);
  }

  protected emitAsync<K extends keyof SynthEvents>(
    event: K,
    data: SynthEvents[K]
  ): Promise<void> {
    return this.eventEmitter.emitAsync(event, data);
  }

  context: AudioContext;
  soundType: SoundType;
  panType: PanType;
  private readonly cacophony?: Cacophony;

  constructor(options: SynthOptions) {
    super();
    this.context = options.context;
    this.soundType = options.soundType ?? SoundType.Oscillator;
    this.panType = options.panType ?? "HRTF";
    this._oscillatorOptions = options.oscillatorOptions ?? {};
    this.cacophony = options.cacophony;
  }

  /**
   * Clones the current Synth instance, creating a deep copy with the option to override specific properties.
   * This method allows for the creation of a new, independent Synth instance based on the current one, with the
   * flexibility to modify certain attributes through the `overrides` parameter. This is particularly useful for
   * creating variations of a synth without affecting the original instance. The cloned instance includes all properties,
   * playback settings, and filters of the original, unless explicitly overridden.
   *
   * @param {SynthCloneOverrides} overrides - An object specifying properties to override in the cloned instance.
   *        This can include audio settings like volume, playback rate, and spatial positioning, as well as
   *        more complex configurations like 3D audio options and filter adjustments.
   * @returns {Sound} A new Sound instance that is a clone of the current sound.
   */
  clone(overrides: Partial<SynthCloneOverrides> = {}): Synth {
    const panType = overrides.panType || this.panType;
    const stereoPan =
      overrides.stereoPan !== undefined
        ? overrides.stereoPan
        : (this.stereoPan ?? 0);
    const threeDOptions = (overrides.threeDOptions ||
      this.threeDOptions) as PannerOptions;
    const volume =
      overrides.volume !== undefined ? overrides.volume : this.volume;
    const position = overrides.position?.length
      ? overrides.position
      : this.position;
    const filters = overrides.filters?.length
      ? overrides.filters
      : this._filters;
    const oscillatorOptions =
      overrides.oscillatorOptions || this._oscillatorOptions;

    const clone = new Synth({
      context: this.context,
      soundType: this.soundType,
      panType,
      oscillatorOptions,
      cacophony: this.cacophony,
    });
    clone._volume = volume;
    clone._position = position;
    clone._stereoPan = stereoPan as number;
    clone._threeDOptions = threeDOptions;
    clone.addFilters(filters);
    return clone;
  }

  /**
   * Generates a Playback instance for the synth without starting playback.
   * This allows for pre-configuration of playback properties such as volume and position before the synth is actually played.
   * @returns {SynthPlayback[]} An array of SynthPlayback instances that are ready to be played.
   */
  preplay(): SynthPlayback[] {
    const engine = this.cacophony?.engine;
    
    // Engine is required - strict no-legacy policy
    if (!engine) {
       throw new Error('CacophonyEngine is required for Synth playback');
    }

    if (!engine.isReady) {
      throw new Error('CacophonyEngine worklet is not ready');
    }
    
    return this.createEnginePlayback(engine);
  }

  private createEnginePlayback(engine: CacophonyEngine): SynthPlayback[] {
    const sourceId = `oscillator-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create oscillator source in the engine
    // Filter out 'custom' type as engine only supports basic waveforms
    const oscType = this.oscillatorOptions.type;
    engine.createOscillatorSource(sourceId, {
      frequency: this.oscillatorOptions.frequency,
      detune: this.oscillatorOptions.detune,
      type: oscType === 'custom' ? undefined : oscType,
      volume: this.volume,
      pan: this.stereoPan ?? 0,
    });
    
    // Create engine-based playback
    const playback = new SynthPlayback(this, sourceId, engine);
    
    // Apply filters and panning settings
    // TODO: Filters are currently legacy-only in SynthPlayback, need to port BiquadFilter
    // for (const filter of this._filters) {
    //   playback.addFilter(filter);
    // }
    
    if (this.panType === "HRTF") {
      playback.threeDOptions = this.threeDOptions;
      playback.position = this.position;
    }
    
    this.playbacks.push(playback);
    return [playback];
  }

  play(): ReturnType<this["preplay"]> {
    const playbacks = super.play() as ReturnType<this["preplay"]>;
    const firstPlayback = playbacks[0];
    if (firstPlayback) {
      this.emit("play", firstPlayback);
    }
    this.cacophony?.emit("globalPlay", { source: this, timestamp: Date.now() });
    return playbacks;
  }

  stop(): void {
    super.stop();
    this.emit("stop", undefined);
    this.cacophony?.emit("globalStop", { source: this, timestamp: Date.now() });
  }

  pause(): void {
    super.pause();
    this.emit("pause", undefined);
    this.cacophony?.emit("globalPause", {
      source: this,
      timestamp: Date.now(),
    });
  }

  get oscillatorOptions(): Partial<OscillatorOptions> {
    return this._oscillatorOptions;
  }

  set oscillatorOptions(options: Partial<OscillatorOptions>) {
    this._oscillatorOptions = options;
    for (const p of this.playbacks) {
      if (p.source instanceof OscillatorNode) {
        if (this.oscillatorOptions.detune) {
          p.source.detune.value = this.oscillatorOptions.detune;
        }
        if (this.oscillatorOptions.frequency) {
          p.source.frequency.value = this.oscillatorOptions.frequency;
        }
        if (this.oscillatorOptions.type) {
          p.source.type = this.oscillatorOptions.type;
        }
      }
    }
  }

  get frequency(): number {
    return (this.oscillatorOptions.frequency as number) || 440;
  }

  set frequency(frequency: number) {
    this._oscillatorOptions.frequency = frequency;
    for (const p of this.playbacks) {
      p.frequency = frequency;
    }
    this.emit("frequencyChange", frequency);
  }

  get detune(): number {
    return this.oscillatorOptions.detune as number;
  }

  set detune(detune: number) {
    this._oscillatorOptions.detune = detune;
    for (const p of this.playbacks) {
      p.detune = detune;
    }
    this.emit("detuneChange", detune);
  }

  get type(): OscillatorType | "custom" {
    return (this.oscillatorOptions.type as OscillatorType | "custom") || "sine";
  }

  set type(type: OscillatorType) {
    this._oscillatorOptions.type = type;
    for (const p of this.playbacks) {
      p.type = type;
    }
    this.emit("typeChange", type);
  }
}
