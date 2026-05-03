import {
  type AudioErrorCode,
  type AudioState,
  generateErrorId,
} from "../playback/index.js";
import type { SoundInstance } from "./audio-manager-types.js";

type AudioStateOverride = Partial<AudioState>;

type NotifySoundListeners = (soundId: string, state: AudioState) => void;

type SoundErrorOptions = {
  id?: string;
  position?: number;
  timestamp?: number;
};

function buildSoundState(
  instance: SoundInstance,
  overrides: AudioStateOverride = {}
): AudioState {
  return {
    isPlaying: instance.playing,
    isLoading: instance.loading,
    isBuffering: instance.buffering,
    volume: instance.volume,
    error: null,
    hasEnded: false,
    ...overrides,
  };
}

function buildSoundError(
  instance: SoundInstance,
  soundId: string,
  code: AudioErrorCode,
  message: string,
  options: SoundErrorOptions = {}
) {
  return {
    id: options.id ?? generateErrorId(),
    message,
    code,
    radio: instance.radio,
    timestamp: options.timestamp ?? Date.now(),
    sourceId: soundId,
    position: options.position,
  };
}

function notifySoundState(
  notifyListeners: NotifySoundListeners,
  soundId: string,
  instance: SoundInstance,
  overrides: AudioStateOverride = {}
): void {
  notifyListeners(soundId, buildSoundState(instance, overrides));
}

function notifySoundError(
  notifyListeners: NotifySoundListeners,
  soundId: string,
  instance: SoundInstance,
  code: AudioErrorCode,
  message: string,
  options: SoundErrorOptions = {}
): void {
  notifySoundState(notifyListeners, soundId, instance, {
    isPlaying: false,
    isLoading: false,
    isBuffering: false,
    hasEnded: false,
    error: buildSoundError(instance, soundId, code, message, options),
  });
}

export { buildSoundError, notifySoundError, notifySoundState };
export type { NotifySoundListeners };
