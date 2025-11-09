/** biome-ignore-all lint/complexity/noUselessConstructor: Required for mixin pattern */
/** biome-ignore-all lint/suspicious/noExplicitAny: Required for mixin pattern */

import type { IPlaybackContainer } from "./container.js";
import type { AudioNode } from "./context.js";
import { TypedEventEmitter } from "./eventEmitter.js";
import type { PlaybackEvents } from "./events.js";
import { FilterManager } from "./filters.js";
import { PannerMixin } from "./panner-mixin.js";
import { VolumeMixin } from "./volume-mixin.js";

export abstract class BasePlayback extends PannerMixin(
  VolumeMixin(FilterManager)
) {
  constructor(...args: any[]) {
    super(...args);
  }
  source?: AudioNode;
  _playing = false;
  origin!: IPlaybackContainer;
  eventEmitter: TypedEventEmitter<PlaybackEvents> =
    new TypedEventEmitter<PlaybackEvents>();

  abstract play(): [this];
  abstract pause(): void;
  abstract stop(): void;

  /**
   * Checks if the audio is currently playing.
   * @returns {boolean} True if the audio is playing, false otherwise.
   */

  get isPlaying(): boolean {
    if (!this.source) {
      return false;
    }
    return this._playing;
  }

  /**
   * Register event listener.
   * @returns Cleanup function
   */
  on<K extends keyof PlaybackEvents>(
    event: K,
    listener: (data: PlaybackEvents[K]) => void
  ): void {
    this.eventEmitter.on(event, listener);
  }

  /**
   * Remove event listener.
   */
  off<K extends keyof PlaybackEvents>(
    event: K,
    listener: (data: PlaybackEvents[K]) => void
  ): void {
    this.eventEmitter.off(event, listener);
  }

  emit<K extends keyof PlaybackEvents>(
    event: K,
    data: PlaybackEvents[K]
  ): void {
    this.eventEmitter.emit(event, data);
  }

  emitAsync<K extends keyof PlaybackEvents>(
    event: K,
    data: PlaybackEvents[K]
  ): Promise<void> {
    return this.eventEmitter.emitAsync(event, data);
  }

  cleanup(): void {
    this.eventEmitter.removeAllListeners();
    super.cleanup();
  }
}
