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
};

function createPlaybackSourceCallbacks({
  instance,
  soundId,
  notifyListeners,
}: SourceCallbackParams): PlaybackSourceCallbacks {
  return {
    onPlaying: () => {
      instance.loading = false;
      instance.buffering = false;
      instance.playing = true;
      notifySoundState(notifyListeners, soundId, instance, {
        isPlaying: true,
        error: null,
      });
    },
    onPaused: () => {
      instance.playing = false;
      instance.buffering = false;
      notifySoundState(notifyListeners, soundId, instance, {
        isPlaying: false,
        error: null,
      });
    },
    onBuffering: (isBuffering) => {
      instance.buffering = isBuffering;
      notifySoundState(notifyListeners, soundId, instance, {
        isPlaying: instance.playing,
        error: null,
      });
    },
    onError: (error) => {
      instance.playing = false;
      instance.loading = false;
      notifySoundError(
        notifyListeners,
        soundId,
        instance,
        "STREAM_FETCH_FAILED",
        error.message
      );
    },
    onEnded: () => {
      instance.playing = false;
      notifySoundState(notifyListeners, soundId, instance, {
        isPlaying: false,
        hasEnded: true,
      });
    },
    onStreamError: (position) => {
      notifySoundError(
        notifyListeners,
        soundId,
        instance,
        "STREAM_INTERRUPTED",
        `Stream interrupted at ${Math.floor(position)}s - URL may need refresh`,
        { position }
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
        isPlaying: true,
        error: null,
      });
    },
    onInactive: () => {
      instance.playing = false;
      notifySoundState(notifyListeners, soundId, instance, {
        isPlaying: false,
        error: null,
      });
    },
    onError: (error) => {
      instance.playing = false;
      instance.loading = false;
      notifySoundError(
        notifyListeners,
        soundId,
        instance,
        "PLAYBACK_FAILED",
        error.message
      );
    },
  };
}

export { createDeviceSourceCallbacks, createPlaybackSourceCallbacks };
