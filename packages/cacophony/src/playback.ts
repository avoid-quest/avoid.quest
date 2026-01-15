/**
 * The Playback class encapsulates the functionality for playing audio in a web application.
 * It integrates with the standardized-audio-context library to provide a cross-browser way to handle audio.
 * This class allows for the manipulation of audio playback through various features such as:
 * - Playing and stopping audio
 * - Looping audio a specific number of times or infinitely
 * - Adjusting volume and playback rate
 * - Applying stereo or 3D (HRTF) panning
 * - Adding and removing filters to modify the audio output
 * - Handling audio looping with custom logic
 * - Fading audio in and out linearly or exponentially
 * - Seeking to specific points in the audio
 * - Checking if the audio is currently playing
 * - Cleaning up resources when the audio is no longer needed
 *
 * The class is designed to be flexible and can be used with different types of audio sources,
 * including buffer sources and media elements. It also provides detailed control over the audio's
 * spatial characteristics when using 3D audio.
 */
/** biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: needed for complex audio processing */

import { BasePlayback } from "./base-playback.js";
import type { BaseSound, LoopCount, PanType } from "./cacophony.js";
import type {
  AudioContext,
  BiquadFilterNode,
} from "./context.js";
import type { Sound } from "./sound.js";
import type { CacophonyEngine } from "./engine/cacophony-engine.js";

type PlaybackCloneOverrides = {
  loopCount: LoopCount;
  panType: PanType;
};

const PlaybackState = {
  Unplayed: 0,
  Playing: 1,
  Paused: 2,
  Stopped: 3,
} as const;

type PlaybackState = (typeof PlaybackState)[keyof typeof PlaybackState];

export class Playback extends BasePlayback implements BaseSound {
  private readonly context: AudioContext;
  loopCount: LoopCount = 0;
  currentLoop = 0;
  origin: Sound;
  private _offset = 0;
  private _startTime = 0;
  private _state: PlaybackState = PlaybackState.Unplayed;
  private _playbackRate = 1;
  
  // Engine-based playback fields
  public readonly sourceId: string;
  private engine: CacophonyEngine;
  private filterIdMap = new Map<BiquadFilterNode, string>();

  /**
   * Creates an instance of the Playback class.
   * Engine-only mode: (origin, sourceId, engine) - Uses CacophonyEngine
   */
  constructor(origin: Sound, sourceId: string, engine: CacophonyEngine) {
    super();
    this.context = origin.context;
    this.origin = origin;
    this.loopCount = origin.loopCount;
    this.setPanType(origin.panType, origin.context);
    this.sourceId = sourceId;
    this.engine = engine;
  }

  get isPlaying(): boolean {
    return this._state === PlaybackState.Playing;
  }

  /**
   * Gets the duration of the audio in seconds.
   * @returns {number} The duration of the audio or NaN if the duration is unknown.
   * @throws {Error} Throws an error if the sound has been cleaned up.
   */

  get duration() {
    // Engine-based playback doesn't have direct access to duration
    // Duration would need to be tracked or queried from engine
    // For now, return NaN as duration is not available in engine mode
    return Number.NaN;
  }

  /**
   * Gets the current playback rate of the audio.
   * @returns {number} The current playback rate.
   */

  get playbackRate() {
    return this._playbackRate;
  }

  /**
   * Sets the playback rate of the audio.
   * @param {number} rate - The playback rate to set.
   * @throws {Error} Throws an error if the sound has been cleaned up or if the source type is unsupported.
   */

  set playbackRate(rate: number) {
    if (rate <= 0) {
      throw new Error("Playback rate must be greater than 0");
    }
    
    if (this._state === PlaybackState.Playing) {
      const elapsed =
        (this.context.currentTime - this._startTime) * this._playbackRate;
      this._offset += elapsed;
      this._startTime = this.context.currentTime;
    }
    this._playbackRate = rate;
    // TODO: Implement setSourcePlaybackRate in engine/protocol if needed dynamically
    // For now, playback rate is set at source creation
  }

  /**
   * Handles the loop event when the audio ends.
   * This method is bound to the 'onended' event of the audio source.
   * It manages looping logic and restarts playback if necessary.
   */
  loopEnded = () => {
    if (this._state !== PlaybackState.Playing) {
      return;
    }

    this.currentLoop += 1;

    if (this.loopCount !== "infinite" && this.currentLoop > this.loopCount) {
      // Track ended naturally - emit ended event before stopping
      this.emit("ended", undefined);
      this.stop();
    } else {
      this.seek(0); // Resets offset and handles play/pause state internally.
      // If it was playing, seek will call play() again.
      this.play();
    }
  };

  /**
   * Starts playing the audio.
   * @returns {[this]} Returns the instance of the Playback class for chaining.
   * @throws {Error} Throws an error if the sound has been cleaned up.
   */

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
        // Resume from pause
        this.engine.resumeSource(this.sourceId);
      } else {
        // Start from beginning or after stop
        this.engine.startSource(this.sourceId, {
          offset: this._offset,
        });
      }

      this._startTime = this.context.currentTime;
      this._state = PlaybackState.Playing;
      this.emit("play", this);

      this.origin.cacophony?.emit("globalPlay", {
        source: this.origin,
        timestamp: Date.now(),
      });

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

    const elapsed =
      (this.context.currentTime - this._startTime) * this._playbackRate;
    this._offset += elapsed;

    this.engine.pauseSource(this.sourceId);
    this._state = PlaybackState.Paused;
    this.emit("pause", undefined);

    this.origin.cacophony?.emit("globalPause", {
      source: this.origin,
      timestamp: Date.now(),
    });
  }

  stop(): void {
    if (
      this._state === PlaybackState.Stopped ||
      this._state === PlaybackState.Unplayed
    ) {
      return;
    }

    this.engine.stopSource(this.sourceId);
    this._offset = 0;
    this._startTime = 0;
    this._state = PlaybackState.Stopped;
    this.emit("stop", undefined);

    this.origin.cacophony?.emit("globalStop", {
      source: this.origin,
      timestamp: Date.now(),
    });
  }

  seek(time: number): void {
    if (!Number.isFinite(time) || time < 0) {
      throw new Error("Invalid time value for seek");
    }

    const wasPlaying = this._state === PlaybackState.Playing;
    if (wasPlaying) {
      this.pause();
    }

    this._offset = time;
    this.engine.seekSource(this.sourceId, time);

    if (wasPlaying) {
      this.play();
    }
  }

  get currentTime(): number {
    if (this._state === PlaybackState.Playing) {
      const elapsed =
        (this.context.currentTime - this._startTime) * this._playbackRate;
      return this._offset + elapsed;
    }
    return this._offset;
  }



  /**
   * Sets whether the audio source should loop.
   * @param {boolean} loop - Whether the audio should loop.
   * @throws {Error} Throws an error if the sound has been cleaned up.
   */
  set sourceLoop(loop: boolean) {
    // Loop is controlled via engine at source creation
    // This setter is kept for API compatibility but doesn't do anything in engine mode
  }

  /**
   * Cleans up resources used by the Playback instance.
   * This method should be called when the audio is no longer needed to free up resources.
   */

  cleanup(): void {
    // Engine handles cleanup automatically
    super.cleanup();
  }

  addFilter(filter: BiquadFilterNode): void {
    // Generate ID and map it
    const filterId = `filter-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.filterIdMap.set(filter, filterId);
    
    // Determine filter type string (handle custom types if any, standard ones match)
    const type = filter.type;
    
    this.engine.addFilter(
      this.sourceId,
      filterId,
      type,
      filter.frequency.value,
      filter.Q.value,
      filter.gain.value
    );
  }

  removeFilter(filter: BiquadFilterNode): void {
    const filterId = this.filterIdMap.get(filter);
    if (filterId) {
      this.engine.removeFilter(this.sourceId, filterId);
      this.filterIdMap.delete(filter);
    }
  }

  /**
   * Updates a filter parameter for engine-based playback.
   */
  setFilterParam(filter: BiquadFilterNode, param: 'frequency' | 'Q' | 'gain' | 'type', value: number | string): void {
    const filterId = this.filterIdMap.get(filter);
    if (filterId) {
      this.engine.setFilterParam(this.sourceId, filterId, param, value);
    }
    // Also update the local node so it stays in sync if inspected
    if (param === 'frequency') filter.frequency.value = value as number;
    if (param === 'Q') filter.Q.value = value as number;
    if (param === 'gain') filter.gain.value = value as number;
    if (param === 'type') filter.type = value as BiquadFilterType;
  }

  /**
   * Sets or gets the loop count for the audio.
   * @param {LoopCount} loopCount - The number of times the audio should loop. 'infinite' for endless looping.
   * @returns {LoopCount} The loop count if no parameter is provided.
   * @throws {Error} Throws an error if the sound has been cleaned up or if the source type is unsupported.
   */

  loop(loopCount?: LoopCount): LoopCount {
    if (loopCount !== undefined) {
      this.loopCount =
        loopCount === "infinite" ? "infinite" : Math.max(0, loopCount);
      this.currentLoop = 0;
      // TODO: Send loop update to engine
      // this.engine.setSourceLoop(this.sourceId, this.loopCount === 'infinite');
    }
    return this.loopCount;
  }

  // Volume overrides
  private _volume: number = 1;
  
  get volume(): number {
    return this._volume;
  }

  set volume(v: number) {
    this._volume = v;
    this.engine.setSourceVolume(this.sourceId, v);
  }

  // Pan overrides
  private _pan: number = 0;
  
  get stereoPan(): number | null {
    return this._pan;
  }

  set stereoPan(v: number) {
    this._pan = v;
    this.engine.setSourcePan(this.sourceId, v);
  }


  /**
   * Creates a clone of the current Playback instance with optional overrides for certain properties.
   * In engine mode, cloning creates a new source in the engine.
   * @param {Partial<PlaybackCloneOverrides>} overrides - An object containing properties to override in the cloned instance.
   * @returns {Playback} A new Playback instance cloned from the current one with the specified overrides applied.
   */
  clone(overrides: Partial<PlaybackCloneOverrides> = {}): Playback {
    // In engine mode, we need to create a new source
    // For now, throw an error as cloning in engine mode requires more complex logic
    throw new Error("Cloning playback in engine mode is not yet supported. Create a new Sound instance instead.");
  }
}
