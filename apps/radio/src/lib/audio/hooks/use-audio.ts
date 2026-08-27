/**
 * useAudio Hook
 *
 * Basic audio playback hook for a single radio source.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioManager } from "../manager/audio-manager.js";
import {
  type AudioErrorCode,
  type AudioState,
  generateErrorId,
  type Radio,
} from "../playback/types.js";

type AudioResources = {
  soundId: string | null;
  unsubscribe: (() => void) | null;
};

function createAudioResources(): AudioResources {
  return { soundId: null, unsubscribe: null };
}

export function useAudio(radio: Radio | null) {
  // Memoize AudioManager instance to ensure stable reference across renders
  const audioManager = useMemo(() => AudioManager.getInstance(), []);
  const [state, setState] = useState<AudioState>({
    error: null,
    hasEnded: false,
    isBuffering: false,
    isLoading: false,
    isPlaying: false,
    volume: 1,
  });

  const resourcesRef = useRef(createAudioResources());
  const volumeRef = useRef<number>(state.volume);

  // Generate unique sound ID
  const getSoundId = useCallback(
    (radioItem: Radio) =>
      `audio_${radioItem.id || radioItem.name}_${Date.now()}`,
    []
  );

  // Cleanup function
  const cleanup = useCallback(() => {
    const resources = resourcesRef.current;
    if (resources.unsubscribe) {
      resources.unsubscribe();
      resources.unsubscribe = null;
    }

    if (resources.soundId) {
      audioManager.cleanupSound(resources.soundId);
      resources.soundId = null;
    }
  }, [audioManager]);

  // Load radio
  const loadRadio = useCallback(
    (newRadio: Radio) => {
      try {
        setState((prev) => ({ ...prev, error: null, isLoading: true }));

        // Cleanup previous sound
        cleanup();

        const soundId = getSoundId(newRadio);
        resourcesRef.current.soundId = soundId;

        // Create sound
        audioManager.createSound(newRadio, soundId);

        // Subscribe to state changes
        resourcesRef.current.unsubscribe = audioManager.subscribe(
          soundId,
          (newState) => {
            setState(newState);
          }
        );

        setState((prev) => ({ ...prev, isLoading: false }));
      } catch (error) {
        const errorObj =
          error instanceof Error ? error : new Error("Unknown error");
        setState((prev) => ({
          ...prev,
          error: {
            code: "LOAD_ERROR",
            id: generateErrorId(),
            message: errorObj.message,
            radio: newRadio,
            timestamp: Date.now(),
          },
          isLoading: false,
        }));
      }
    },
    [audioManager, cleanup, getSoundId]
  );

  // Helper: Set play error state
  const setPlayError = useCallback((error: unknown, code: AudioErrorCode) => {
    const errorObj = error instanceof Error ? error : new Error("Play failed");
    setState((prev) => ({
      ...prev,
      error: {
        code,
        id: generateErrorId(),
        message: errorObj.message,
        timestamp: Date.now(),
      },
    }));
  }, []);

  // Helper: Check if error indicates sound was not found
  const isSoundNotFoundError = useCallback(
    (error: Error): boolean =>
      error.message.includes("cleaned up") ||
      error.message.includes("not found"),
    []
  );

  // Helper: Ensure sound is loaded before playing
  const ensureSoundLoaded = useCallback(async (): Promise<boolean> => {
    if (!radio) {
      return false;
    }

    if (!resourcesRef.current.soundId) {
      await loadRadio(radio);
    }

    return resourcesRef.current.soundId !== null;
  }, [radio, loadRadio]);

  // Helper: Attempt to play the sound
  const attemptPlaySound = useCallback(async (): Promise<void> => {
    const { soundId } = resourcesRef.current;
    if (!soundId) {
      return;
    }
    await audioManager.playSound(soundId, volumeRef.current);
  }, [audioManager]);

  // Helper: Reload radio and play sound
  const reloadAndPlay = useCallback(async (): Promise<boolean> => {
    if (!radio) {
      return false;
    }

    try {
      await loadRadio(radio);
      await attemptPlaySound();
      return true;
    } catch (reloadError) {
      setPlayError(reloadError, "PLAY_ERROR");
      return false;
    }
  }, [radio, loadRadio, attemptPlaySound, setPlayError]);

  // Helper: Handle play error with retry logic
  const handlePlayError = useCallback(
    async (error: unknown): Promise<void> => {
      const errorObj =
        error instanceof Error ? error : new Error("Play failed");

      if (isSoundNotFoundError(errorObj)) {
        const success = await reloadAndPlay();
        if (success) {
          return;
        }
      }

      setPlayError(error, "PLAY_ERROR");
    },
    [isSoundNotFoundError, reloadAndPlay, setPlayError]
  );

  // Play function
  const play = useCallback(async () => {
    if (!radio) {
      return;
    }

    try {
      const isLoaded = await ensureSoundLoaded();
      if (!isLoaded) {
        return;
      }

      await attemptPlaySound();
    } catch (error) {
      await handlePlayError(error);
    }
  }, [radio, ensureSoundLoaded, attemptPlaySound, handlePlayError]);

  // Pause function
  const pause = useCallback(() => {
    const { soundId } = resourcesRef.current;
    if (!soundId) {
      return;
    }
    audioManager.pauseSound(soundId);
  }, [audioManager]);

  // Stop function
  const stop = useCallback(() => {
    const { soundId } = resourcesRef.current;
    if (!soundId) {
      return;
    }
    audioManager.stopSound(soundId);
  }, [audioManager]);

  // Toggle play/pause
  const togglePlayPause = useCallback(async () => {
    if (state.isPlaying) {
      pause();
    } else {
      await play();
    }
  }, [state.isPlaying, play, pause]);

  // Set volume
  const setVolume = useCallback(
    (volume: number) => {
      const { soundId } = resourcesRef.current;
      if (!soundId) {
        return;
      }
      audioManager.setVolume(soundId, volume);
    },
    [audioManager]
  );

  // Sync volume ref with state
  useEffect(() => {
    volumeRef.current = state.volume;
  }, [state.volume]);

  // Load radio when radio changes
  useEffect(() => {
    if (radio) {
      loadRadio(radio);
    } else {
      cleanup();
    }
  }, [radio, loadRadio, cleanup]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      cleanup();
    },
    [cleanup]
  );

  return {
    ...state,
    loadRadio,
    pause,
    play,
    setVolume,
    stop,
    togglePlayPause,
  };
}
