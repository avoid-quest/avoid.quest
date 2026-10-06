import {
  type AudioErrorCode,
  type AudioState,
  generateErrorId,
} from "../playback/index.js";
import type { SoundInstance } from "./audio-manager-types.js";

type AudioStateOverride = Partial<AudioState>;

type NotifySoundListeners = (soundId: string, state: AudioState) => void;

type SoundErrorOptions = {
  cause?: unknown;
  duringStart?: boolean;
  id?: string;
  position?: number;
  timestamp?: number;
};

function buildSoundState(
  instance: SoundInstance,
  overrides: AudioStateOverride = {}
): AudioState {
  return {
    error: null,
    hasEnded: false,
    isBuffering: instance.buffering,
    isLoading: instance.loading,
    isPlaying: instance.playing,
    volume: instance.volume,
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
    cause: options.cause,
    code,
    duringStart: options.duringStart,
    id: options.id ?? generateErrorId(),
    message,
    position: options.position,
    radio: instance.radio,
    sourceId: soundId,
    timestamp: options.timestamp ?? Date.now(),
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
    error: buildSoundError(instance, soundId, code, message, options),
    hasEnded: false,
    isBuffering: false,
    isLoading: false,
    isPlaying: false,
  });
}

export type { NotifySoundListeners };
export { buildSoundError, notifySoundError, notifySoundState };
