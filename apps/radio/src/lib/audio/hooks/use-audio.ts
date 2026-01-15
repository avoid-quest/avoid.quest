/**
 * useAudio Hook
 *
 * Basic audio playback hook for a single radio source.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioManager } from "../manager/audio-manager.js";
import type { AudioErrorCode, AudioState, Radio } from "../playback/types.js";

export function useAudio(radio: Radio | null) {
  // Memoize AudioManager instance to ensure stable reference across renders
  const audioManager = useMemo(() => AudioManager.getInstance(), []);
  const [state, setState] = useState<AudioState>({
    isPlaying: false,
    isLoading: false,
    volume: 1,
    error: null,
    hasEnded: false,
  });

  const soundIdRef = useRef<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const volumeRef = useRef<number>(state.volume);

  // Generate unique sound ID
  const getSoundId = useCallback(
    (radioItem: Radio) =>
      `audio_${radioItem.id || radioItem.name}_${Date.now()}`,
    []
  );

  // Cleanup function
  const cleanup = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (soundIdRef.current) {
      audioManager.cleanupSound(soundIdRef.current);
      soundIdRef.current = null;
    }
  }, [audioManager]);

  // Load radio
  const loadRadio = useCallback(
    async (newRadio: Radio) => {
      try {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        // Cleanup previous sound
        cleanup();

        const soundId = getSoundId(newRadio);
        soundIdRef.current = soundId;

        // Create sound
        await audioManager.createSound(newRadio, soundId);

        // Subscribe to state changes
        unsubscribeRef.current = audioManager.subscribe(soundId, (newState) => {
          setState(newState);
        });

        setState((prev) => ({ ...prev, isLoading: false }));
      } catch (error) {
        const errorObj =
          error instanceof Error ? error : new Error("Unknown error");
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: {
            message: errorObj.message,
            code: "LOAD_ERROR",
            radio: newRadio,
            timestamp: Date.now(),
          },
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
        message: errorObj.message,
        code,
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

    if (!soundIdRef.current) {
      await loadRadio(radio);
    }

    return soundIdRef.current !== null;
  }, [radio, loadRadio]);

  // Helper: Attempt to play the sound
  const attemptPlaySound = useCallback(async (): Promise<void> => {
    if (!soundIdRef.current) {
      return;
    }
    await audioManager.playSound(soundIdRef.current, volumeRef.current);
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
    if (!soundIdRef.current) {
      return;
    }
    audioManager.pauseSound(soundIdRef.current);
  }, [audioManager]);

  // Stop function
  const stop = useCallback(() => {
    if (!soundIdRef.current) {
      return;
    }
    audioManager.stopSound(soundIdRef.current);
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
      if (!soundIdRef.current) {
        return;
      }
      audioManager.setVolume(soundIdRef.current, volume);
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
    play,
    pause,
    stop,
    setVolume,
    togglePlayPause,
    loadRadio,
  };
}
