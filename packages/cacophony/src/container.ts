/** biome-ignore-all lint/complexity/noUselessConstructor: Required for mixin pattern */
/** biome-ignore-all lint/suspicious/noExplicitAny: Required for mixin pattern */
import type { BasePlayback } from "./base-playback.js";
import type { Position } from "./cacophony.js";
import type { FilterManager } from "./filters.js";

type Constructor<T = FilterManager> = abstract new (...args: unknown[]) => T;
export type IPlaybackContainer = {
  play(): BasePlayback[];
  stop(): void;
  pause(): void;
  addFilter(filter: BiquadFilterNode): void;
  removeFilter(filter: BiquadFilterNode): void;
  isPlaying: boolean;
  position: Position;
  threeDOptions: PannerOptions;
  stereoPan: number | null;
  volume: number;
};

export function PlaybackContainer<TBase extends Constructor>(Base: TBase) {
  // @ts-expect-error - Mixin constructor pattern requirement
  abstract class PlaybackContainerClass extends Base {
    constructor(...args: any[]) {
      super(...args);
    }
    playbacks: BasePlayback[] = [];
    _position: Position = [0, 0, 0];
    _stereoPan = 0;
    _threeDOptions: PannerOptions = {
      coneInnerAngle: 360,
      coneOuterAngle: 360,
      coneOuterGain: 0,
      distanceModel: "inverse",
      maxDistance: 10_000,
      channelCount: 2,
      channelCountMode: "clamped-max",
      channelInterpretation: "speakers",
      panningModel: "HRTF",
      refDistance: 1,
      rolloffFactor: 1,
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      orientationX: 0,
      orientationY: 0,
      orientationZ: 0,
    };
    _volume = 1;

    abstract preplay(): BasePlayback[];

    /**
     * Starts playback of the sound and returns a Playback instance representing this particular playback.
     * Multiple Playback instances can be created by calling this method multiple times,
     * allowing for the same sound to be played concurrently with different settings.
     * @returns {Playback[]} An array containing the Playback instances that have been started.
     */

    play(): BasePlayback[] {
      const playback = this.preplay();
      for (const p of playback) {
        p.play();
      }
      return playback;
    }

    /**
     * Stops all current playbacks of the sound immediately. This will halt the sound regardless of how many times it has been played.
     */

    stop() {
      for (const p of this.playbacks) {
        p.stop();
      }
      this.playbacks = [];
    }

    /**
     * Pauses all current playbacks of the sound.
     */

    pause(): void {
      for (const playback of this.playbacks) {
        playback.pause();
      }
    }

    /**
     * Adds a BiquadFilterNode to the container's filter chain.
     * Filters are applied in the order they are added.
     * @param { BiquadFilterNode } filter - The filter to add to the chain.
     */

    addFilter(filter: BiquadFilterNode): void {
      super.addFilter(filter);
      for (const p of this.playbacks) {
        p.addFilter(filter);
      }
    }

    /**
     * Removes a BiquadFilterNode from the container's filter chain.
     * If the filter is not part of the chain, the method has no effect.
     * @param { BiquadFilterNode } filter - The filter to remove from the chain.
     */

    removeFilter(filter: BiquadFilterNode): void {
      super.removeFilter(filter);
      for (const p of this.playbacks) {
        p.removeFilter(filter);
      }
    }

    /**
     * Returns a boolean indicating whether the object is currently playing.
     * an object is playing if any of its playbacks are currently playing.
     * @returns {boolean} True if the object is playing, false otherwise.
     */

    get isPlaying(): boolean {
      return this.playbacks.some((p) => p.isPlaying);
    }

    /**
     * Retrieves the current 3D spatial position of the sound in the audio context.
     * The position is returned as an array of three values[x, y, z].
     * @returns { Position } The current position of the sound.
     */

    get position(): Position {
      return [
        this._threeDOptions.positionX as number,
        this._threeDOptions.positionY as number,
        this._threeDOptions.positionZ as number,
      ];
    }

    /**
     * Sets the 3D spatial position of the sound in the audio context.
     * The position is an array of three values[x, y, z].
     * This method updates the position of all active playbacks of the sound.
     * @param { Position } position - The new position of the sound.
     */

    set position(position: Position) {
      this._threeDOptions.positionX = position[0];
      this._threeDOptions.positionY = position[1];
      this._threeDOptions.positionZ = position[2];
      for (const p of this.playbacks) {
        p.position = position;
      }
    }

    get threeDOptions(): PannerOptions {
      return this._threeDOptions;
    }

    set threeDOptions(options: Partial<PannerOptions>) {
      this._threeDOptions = { ...this._threeDOptions, ...options };
      for (const p of this.playbacks) {
        p.threeDOptions = this._threeDOptions;
      }
    }

    get stereoPan(): number | null {
      return this._stereoPan;
    }

    set stereoPan(value: number) {
      this._stereoPan = value;
      for (const p of this.playbacks) {
        p.stereoPan = value;
      }
    }

    /***
     * Gets the volume of the sound. This volume level affects all current and future playbacks of this sound instance.
     * The volume is specified as a linear value between 0 (silent) and 1 (full volume).
     *
     * @returns {number} The current volume of the sound.
     */

    get volume(): number {
      return this._volume;
    }

    /***
     * Sets the volume of the sound. This volume level affects all current and future playbacks of this sound instance.
     * The volume is specified as a linear value between 0 (silent) and 1 (full volume).
     *
     * @param {number} volume - The new volume level for the sound.
     */

    set volume(volume: number) {
      this._volume = volume;
      for (const p of this.playbacks) {
        if ("volume" in p && typeof p.volume === "number") {
          (p as { volume: number }).volume = volume;
        }
      }
    }
  }
  return PlaybackContainerClass;
}
