import type {
  DeviceSourceCallbacks,
  PlaybackSourceCallbacks,
} from "../playback/index.js";
import {
  type NotifySoundListeners,
  notifySoundError,
  notifySoundState,
} from "./audio-manager-state.js";
import type { SoundInstance } from "./audio-manager-types.js";

type SourceCallbackParams = {
  instance: SoundInstance;
  soundId: string;
  notifyListeners: NotifySoundListeners;
  isCurrent?: () => boolean;
  isStarting?: () => boolean;
};

function createPlaybackSourceCallbacks({
  instance,
  soundId,
  notifyListeners,
  isCurrent = () => true,
  isStarting = () => instance.loading,
}: SourceCallbackParams): PlaybackSourceCallbacks {
  return {
    onBuffering: (isBuffering) => {
      if (!isCurrent()) {
        return;
      }
      instance.buffering = isBuffering;
      notifySoundState(notifyListeners, soundId, instance, {
        error: null,
        isPlaying: instance.playing,
      });
    },
    onEnded: () => {
      if (!isCurrent()) {
        return;
      }
      instance.playing = false;
      notifySoundState(notifyListeners, soundId, instance, {
        hasEnded: true,
        isPlaying: false,
      });
    },
    onError: (error, recoveryPending) => {
      if (!isCurrent()) {
        return;
      }
      const duringStart = isStarting();
      instance.playing = false;
      instance.loading = false;
      notifySoundError(
        notifyListeners,
        soundId,
        instance,
        "STREAM_FETCH_FAILED",
        error.message,
        { cause: error, duringStart, recoveryPending }
      );
    },
    onPaused: () => {
      if (!isCurrent()) {
        return;
      }
      instance.playing = false;
      instance.buffering = false;
      notifySoundState(notifyListeners, soundId, instance, {
        error: null,
        isPlaying: false,
      });
    },
    onPlaying: () => {
      if (!isCurrent()) {
        return;
      }
      instance.loading = false;
      instance.buffering = false;
      instance.playing = true;
      notifySoundState(notifyListeners, soundId, instance, {
        error: null,
        isPlaying: true,
      });
    },
    onStreamError: (position, error) => {
      if (!isCurrent()) {
        return;
      }
      notifySoundError(
        notifyListeners,
        soundId,
        instance,
        "STREAM_INTERRUPTED",
        `Stream interrupted at ${Math.floor(position)}s - URL may need refresh`,
        { cause: error, position }
      );
    },
  };
}

function createDeviceSourceCallbacks({
  instance,
  soundId,
  notifyListeners,
}: SourceCallbackParams): DeviceSourceCallbacks {
  return {
    onActive: () => {
      instance.loading = false;
      instance.playing = true;
      notifySoundState(notifyListeners, soundId, instance, {
        error: null,
        isPlaying: true,
      });
    },
    onError: (error) => {
      const duringStart = instance.loading;
      instance.playing = false;
      instance.loading = false;
      notifySoundError(
        notifyListeners,
        soundId,
        instance,
        "PLAYBACK_FAILED",
        error.message,
        { cause: error, duringStart }
      );
    },
    onInactive: () => {
      instance.playing = false;
      notifySoundState(notifyListeners, soundId, instance, {
        error: null,
        isPlaying: false,
      });
    },
  };
}

export { createDeviceSourceCallbacks, createPlaybackSourceCallbacks };
