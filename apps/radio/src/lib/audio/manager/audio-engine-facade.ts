import type { AudioManager } from "./audio-manager.js";

export const AUDIO_ENGINE_FACADE_PUBLIC_METHOD_BUDGET = 15;

/**
 * Architecture decision for the radio audio engine migration:
 * AudioManager remains the singleton-backed compatibility object, while
 * AudioEngineFacade is the narrow subsystem boundary new action paths should
 * consume. The budget counts callable facade methods, not legacy AudioManager
 * shims retained for unmigrated callers.
 */
export type AudioEngineFacade = {
  playback: {
    play: (soundId: string, volume?: number) => Promise<void>;
    pause: (soundId: string) => void;
    seek: (soundId: string, position: number) => void;
    refreshStreamUrl: (
      soundId: string,
      newUrl: string,
      seekPosition?: number
    ) => Promise<void>;
  };
  volume: {
    setChannelVolume: (soundId: string, volume: number) => void;
    setMasterVolume: (volume: number) => void;
  };
};

export function countAudioEngineFacadeMethods(
  facade: AudioEngineFacade
): number {
  return Object.values(facade).reduce((count, subsystem) => {
    return (
      count +
      Object.values(subsystem).filter((member) => typeof member === "function")
        .length
    );
  }, 0);
}

export function createAudioEngineFacade(
  manager: AudioManager
): AudioEngineFacade {
  return {
    playback: {
      play: (soundId, volume) => manager.playSound(soundId, volume),
      pause: (soundId) => manager.pauseSound(soundId),
      seek: (soundId, position) => manager.seekSound(soundId, position),
      refreshStreamUrl: (soundId, newUrl, seekPosition) =>
        manager.refreshStreamUrl(soundId, newUrl, seekPosition),
    },
    volume: {
      setChannelVolume: (soundId, volume) => manager.setVolume(soundId, volume),
      setMasterVolume: (volume) => manager.setGlobalVolume(volume),
    },
  };
}
