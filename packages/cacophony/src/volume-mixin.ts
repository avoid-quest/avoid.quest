/** biome-ignore-all lint/complexity/noUselessConstructor: Required for mixin pattern */
/** biome-ignore-all lint/suspicious/noExplicitAny: Required for mixin pattern */
import type { GainNode } from "./context.js";
import type { FilterManager } from "./filters.js";

export type VolumeCloneOverrides = {
  volume?: number;
};

type Constructor<T = FilterManager> = abstract new (...args: unknown[]) => T;

export function VolumeMixin<TBase extends Constructor>(Base: TBase) {
  // @ts-expect-error - Mixin constructor pattern requirement
  abstract class VolumeMixinClass extends Base {
    constructor(...args: any[]) {
      super(...args);
    }
    gainNode?: GainNode;

    setGainNode(gainNode: GainNode) {
      this.gainNode = gainNode;
    }

    cleanup(): void {
      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = undefined;
      }
      super.cleanup();
    }

    /**
     * Gets the current volume of the audio.
     * @throws {Error} Throws an error if the sound has been cleaned up.
     * @returns {number} The current volume.
     */

    get volume(): number {
      if (!this.gainNode) {
        throw new Error(
          "Cannot get volume of a sound that has been cleaned up"
        );
      }
      return this.gainNode.gain.value;
    }

    /**
     * Sets the volume of the audio.
     * @param {number} v - The volume to set.
     * @throws {Error} Throws an error if the sound has been cleaned up.
     */

    set volume(v: number) {
      if (!this.gainNode) {
        throw new Error(
          "Cannot set volume of a sound that has been cleaned up"
        );
      }
      this.gainNode.gain.value = v;
    }
  }

  return VolumeMixinClass;
}
