import type { AudioManager } from "./audio-manager.js";

export const AUDIO_ENGINE_FACADE_PUBLIC_METHOD_BUDGET = 15;

type AudioEngineManager = Pick<
  AudioManager,
  | "playSound"
  | "pauseSound"
  | "seekSound"
  | "refreshStreamUrl"
  | "setVolume"
  | "setGlobalVolume"
>;

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
      seekPosition?: number,
      streamFormat?: "hls" | "progressive"
    ) => Promise<void>;
  };
  volume: {
    setChannelVolume: (soundId: string, volume: number) => void;
    setMasterVolume: (volume: number) => void;
  };
};

type AudioEngineFacadeSubsystem = AudioEngineFacade[keyof AudioEngineFacade];

function countFacadeSubsystemMethods(
  subsystem: AudioEngineFacadeSubsystem
): number {
  return Object.values(subsystem).filter(
    (member) => typeof member === "function"
  ).length;
}

export function countAudioEngineFacadeMethods(
  facade: AudioEngineFacade
): number {
  return Object.values(facade).reduce(
    (count, subsystem) => count + countFacadeSubsystemMethods(subsystem),
    0
  );
}

export function createAudioEngineFacade(
  manager: AudioEngineManager
): AudioEngineFacade {
  return {
    playback: {
      pause: (soundId) => manager.pauseSound(soundId),
      play: (soundId, volume) => manager.playSound(soundId, volume),
      refreshStreamUrl: (soundId, newUrl, seekPosition, streamFormat) =>
        streamFormat
          ? manager.refreshStreamUrl(
              soundId,
              newUrl,
              seekPosition,
              streamFormat
            )
          : manager.refreshStreamUrl(soundId, newUrl, seekPosition),
      seek: (soundId, position) => manager.seekSound(soundId, position),
    },
    volume: {
      setChannelVolume: (soundId, volume) => manager.setVolume(soundId, volume),
      setMasterVolume: (volume) => manager.setGlobalVolume(volume),
    },
  };
}
