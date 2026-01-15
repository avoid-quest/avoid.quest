/**
 * The Sound class represents an audio asset within a web application, providing a high-level interface
 * for loading, manipulating, and playing audio. It supports both buffer-based and media element-based audio,
 * allowing for efficient playback and manipulation of sound resources.
 *
 * A Sound instance can manage multiple Playback instances, which represent individual playbacks of the sound.
 * This allows for the same sound to be played multiple times simultaneously or with different settings (e.g., volume,
 * playback rate, spatial positioning). The Sound class provides methods to control these playbacks collectively or individually.
 *
 * Key features include:
 * - Loading audio from a URL or using a pre-loaded buffer.
 * - Playing, pausing, resuming, and stopping audio playback.
 * - Looping audio a specific number of times or infinitely.
 * - Adjusting volume, playback rate, and spatial positioning (for 3D audio).
 * - Applying audio filters for effects like reverb, equalization, etc.
 * - Cloning the Sound instance for independent manipulation and playback.
 *
 * The relationship between Sound and Playback is central to the design of the audio system. A Sound object acts as a container
 * and manager for one or more Playback objects. Each Playback object represents a single instance of the sound being played,
 * and can be controlled individually. This architecture allows for complex audio behaviors, such as playing multiple overlapping
 * instances of a sound with different settings, without requiring the user to manually manage each playback instance.
 */

import {
  type BaseSound,
  type Cacophony,
  type LoopCount,
  type PanType,
  SoundType,
} from "./cacophony.js";
import { PlaybackContainer } from "./container.js";
import type {
  AudioBuffer,
  AudioContext,
  BiquadFilterNode,
  GainNode,
  SourceNode,
} from "./context.js";
import { TypedEventEmitter } from "./eventEmitter.js";
import type { SoundEvents } from "./events.js";
import { FilterManager } from "./filters.js";
import type { PanCloneOverrides } from "./panner-mixin.js";
import { Playback } from "./playback.js";
import { createStream } from "./stream.js";
import type { VolumeCloneOverrides } from "./volume-mixin.js";

type SoundCloneOverrides = PanCloneOverrides &
  VolumeCloneOverrides & {
    loopCount?: LoopCount;
    playbackRate?: number;
    filters?: BiquadFilterNode[];
  };

export class Sound
  extends PlaybackContainer(FilterManager)
  implements BaseSound
{
  playbacks: Playback[] = [];
  buffer?: AudioBuffer;
  context: AudioContext;
  loopCount: LoopCount = 0;
  private _playbackRate = 1;
  private readonly eventEmitter: TypedEventEmitter<SoundEvents> =
    new TypedEventEmitter<SoundEvents>();
  url: string;
  soundType: SoundType;
  panType: PanType;
  private readonly _cacophony?: Cacophony;
  // Abort controller for streaming
  private _streamAbortController?: AbortController;

  constructor(options: {
    url: string;
    buffer: AudioBuffer | undefined;
    context: AudioContext;
    soundType?: SoundType;
    panType?: PanType;
    cacophony?: Cacophony;
  }) {
    super();
    this.url = options.url;
    this.buffer = options.buffer;
    this.context = options.context;
    this.soundType = options.soundType ?? SoundType.Buffer;
    this.panType = options.panType ?? "HRTF";
    this._cacophony = options.cacophony;
  }

  get cacophony(): Cacophony | undefined {
    return this._cacophony;
  }

  get volume(): number {
    return super.volume;
  }

  set volume(volume: number) {
    super.volume = volume;
    this.emit("volumeChange", volume);
  }

  /**
   * Register event listener.
   * @returns Cleanup function
   */
  on<K extends keyof SoundEvents>(
    event: K,
    listener: (data: SoundEvents[K]) => void
  ): void {
    this.eventEmitter.on(event, listener);
  }

  /**
   * Remove event listener.
   */
  off<K extends keyof SoundEvents>(
    event: K,
    listener: (data: SoundEvents[K]) => void
  ): void {
    this.eventEmitter.off(event, listener);
  }

  protected emit<K extends keyof SoundEvents>(
    event: K,
    data: SoundEvents[K]
  ): void {
    this.eventEmitter.emit(event, data);
  }

  protected async emitAsync<K extends keyof SoundEvents>(
    event: K,
    data: SoundEvents[K]
  ): Promise<void> {
    return await this.eventEmitter.emitAsync(event, data);
  }

  /**
   * Clones the current Sound instance, creating a deep copy with the option to override specific properties.
   * This method allows for the creation of a new, independent Sound instance based on the current one, with the
   * flexibility to modify certain attributes through the `overrides` parameter. This is particularly useful for
   * creating variations of a sound without affecting the original instance. The cloned instance includes all properties,
   * playback settings, and filters of the original, unless explicitly overridden.
   *
   * @param {SoundCloneOverrides} overrides - An object specifying properties to override in the cloned instance.
   *        This can include audio settings like volume, playback rate, and spatial positioning, as well as
   *        more complex configurations like 3D audio options and filter adjustments.
   * @returns {Sound} A new Sound instance that is a clone of the current sound.
   */

  clone(overrides: Partial<SoundCloneOverrides> = {}): Sound {
    const panType = overrides.panType || this.panType;
    const stereoPan =
      overrides.stereoPan !== undefined ? overrides.stereoPan : this.stereoPan;
    const threeDOptions = (overrides.threeDOptions ||
      this.threeDOptions) as PannerOptions;
    const loopCount =
      overrides.loopCount !== undefined ? overrides.loopCount : this.loopCount;
    const playbackRate = overrides.playbackRate || this.playbackRate;
    const volume =
      overrides.volume !== undefined ? overrides.volume : this.volume;
    const position =
      overrides.position !== undefined ? overrides.position : this.position;
    const filters = overrides.filters?.length
      ? overrides.filters
      : this._filters;

    const clone = new Sound({
      url: this.url,
      buffer: this.buffer,
      context: this.context,
      soundType: this.soundType,
      panType,
      cacophony: this.cacophony,
    });
    clone.loop(loopCount);
    clone.playbackRate = playbackRate;
    clone.volume = volume;
    if (panType === "HRTF") {
      clone.threeDOptions = threeDOptions;
      clone.position = position;
    } else {
      clone.stereoPan = stereoPan as number;
    }
    clone.addFilters(filters);
    return clone;
  }

  /**
   * Ensures AudioContext is resumed (required for Chrome autoplay policy).
   */
  private ensureContextResumed(): void {
    if (this.context.state === "suspended") {
      this.context.resume().catch((error) => {
        console.warn("Failed to resume AudioContext:", error);
        this.emitAsync("soundError", {
          url: this.url,
          error: error as Error,
          errorType: "context",
          timestamp: Date.now(),
          recoverable: true,
        });
      });
    }
  }




  /**
   * Generates a Playback instance for the sound without starting playback.
   * This allows for pre-configuration of playback properties such as volume and position before the sound is actually played.
   * @returns {Playback[]} An array of Playback instances that are ready to be played.
   */

  preplay(): Playback[] {
    try {
      // Ensure AudioContext is resumed (required for Chrome autoplay policy)
      this.ensureContextResumed();

      // Engine is required - no legacy fallback
      const engine = this._cacophony?.engine;
      if (!engine) {
        throw new Error('CacophonyEngine is required but not available');
      }
      
      if (!engine.isReady) {
        throw new Error('CacophonyEngine worklet is not ready');
      }

      // Generate unique source ID
      const sourceId = `source-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      if (this.buffer) {
        // Buffered audio - load buffer into engine
        const bufferId = `buffer-${this.url}`;
        engine.loadBuffer(bufferId, this.buffer);

        // Create source in worklet
        engine.createSource(sourceId, bufferId, {
          loop: this.loopCount === 'infinite',
          playbackRate: this._playbackRate,
        });
      } else if (this.soundType === SoundType.Streaming) {
        // Full engine-based streaming: StreamSource in worklet receives decoded chunks
        engine.createStreamSource(sourceId);
        
        // Create abort controller for this stream
        this._streamAbortController = new AbortController();
        
        // Start streaming - createStream handles fetching, decoding, and sending chunks to engine
        createStream(this.url, this.context, engine, sourceId, this._streamAbortController.signal);
      } else {
        throw new Error(`Unknown sound type: ${this.soundType}`);
      }

      // Create new-style playback that controls the engine source
      const playback = new Playback(this, sourceId, engine);
      
      // Set up event forwarding from engine
      const handleSourceEnded = (data: any) => {
        if (data.sourceId === sourceId) {
          playback.emit('ended', undefined);
        }
      };
      
      const handleSourceError = (data: any) => {
        if (data.sourceId === sourceId) {
          playback.emit('error', {
            error: new Error(data.error),
            timestamp: Date.now(),
            recoverable: false,
            errorType: 'source', // Use 'source' as 'playback' is not a valid error type
          });
        }
      };
      
      engine.on('sourceEnded', handleSourceEnded);
      engine.on('sourceError', handleSourceError);

      // Set up error propagation from playback to sound
      playback.on("error", (errorEvent) => {
        this.emitAsync("soundError", {
          url: this.url,
          error: errorEvent.error,
          errorType: "playback",
          timestamp: errorEvent.timestamp,
          recoverable: errorEvent.recoverable,
        });
      });

      this.playbacks.push(playback);
      return [playback];
    } catch (error) {
      const errorEvent = {
        url: this.url,
        error: error as Error,
        errorType: "playback" as const,
        timestamp: Date.now(),
        recoverable: true,
      };
      this.emitAsync("soundError", errorEvent);
      throw error;
    }
  }

  play(): ReturnType<this["preplay"]> {
    const playbacks = super.play() as ReturnType<this["preplay"]>;
    const firstPlayback = playbacks[0];
    if (firstPlayback) {
      this.emit("play", firstPlayback);
    }
    return playbacks;
  }

  stop(): void {
    // Abort any active streaming
    if (this._streamAbortController) {
      this._streamAbortController.abort();
      this._streamAbortController = undefined;
    }
    super.stop();
    this.emit("stop", undefined);
  }

  pause(): void {
    super.pause();
    this.emit("pause", undefined);
  }

  /**
   * Seeks to a specific time within the sound's playback.
   * @param { number } time - The time in seconds to seek to.
   * This method iterates through all active `Playback` instances and calls their `seek()` method with the specified time.
   */

  seek(time: number): void {
    for (const playback of this.playbacks) {
      playback.seek(time);
    }
  }

  /**
   * Retrieves the duration of the sound in seconds.
   * If the sound is based on an AudioBuffer, it returns the duration of the buffer.
   * Otherwise, if the sound has not been played and is a MediaElementSource, it returns NaN, indicating that the duration is unknown or not applicable.
   * @returns { number } The duration of the sound in seconds.
   */

  get duration() {
    if (this.playbacks.length > 0) {
      const firstPlayback = this.playbacks[0];
      return firstPlayback?.duration ?? Number.NaN;
    }
    return this.buffer?.duration || Number.NaN;
  }

  /**
   * Sets or retrieves the loop behavior for the sound.
   * If loopCount is provided, the sound will loop the specified number of times.
   * If loopCount is 'infinite', the sound will loop indefinitely until stopped.
   * If no argument is provided, the method returns the current loop count setting.
   * @param { LoopCount } [loopCount] - The number of times to loop or 'infinite' for indefinite looping.
   * @returns { LoopCount } The current loop count setting if no argument is provided.
   */

  loop(loopCount?: LoopCount): LoopCount {
    if (loopCount === undefined) {
      return this.loopCount;
    }
    this.loopCount = loopCount;
    for (const p of this.playbacks) {
      p.loop(loopCount);
    }
    return this.loopCount;
  }

  get playbackRate(): number {
    return this._playbackRate;
  }

  set playbackRate(rate: number) {
    this._playbackRate = rate;
    for (const p of this.playbacks) {
      p.playbackRate = rate;
    }
    this.emit("rateChange", rate);
  }

  cleanup(): void {
    for (const p of this.playbacks) {
      p.cleanup();
    }
    this.playbacks = [];
    this.eventEmitter.removeAllListeners();
  }
}
