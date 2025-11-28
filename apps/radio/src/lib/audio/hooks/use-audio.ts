import { useCallback, useEffect, useRef, useState } from "react";
import type { Radio } from "../../types";
import { AudioManager, type AudioState } from "../audio-manager";

export function useAudio(radio: Radio | null) {
  const audioManager = AudioManager.getInstance();
  const [state, setState] = useState<AudioState>({
    isPlaying: false,
    isLoading: false,
    volume: 1,
    error: null,
    hasEnded: false,
  });

  const soundIdRef = useRef<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Generate unique sound ID
  const getSoundId = useCallback(
    (radioItem: Radio) =>
      `audio_${radioItem.id || radioItem.name}_${Date.now()}`,
    []
  );

  // Cleanup function
  const cleanup = useCallback(async () => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (soundIdRef.current) {
      await audioManager.cleanupSound(soundIdRef.current);
      soundIdRef.current = null;
    }
  }, [audioManager]);

  // Load radio
  const loadRadio = useCallback(
    async (newRadio: Radio) => {
      try {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        // Cleanup previous sound
        await cleanup();

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

  // Play function
  const play = useCallback(async () => {
    if (!radio) {
      return;
    }

    try {
      // If we don't have a sound ID or the sound has been cleaned up, reload it
      if (!soundIdRef.current) {
        await loadRadio(radio);
      }

      if (!soundIdRef.current) {
        return;
      }

      await audioManager.playSound(soundIdRef.current, state.volume);
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error("Play failed");

      // If the sound was cleaned up, reload it and try again
      if (
        errorObj.message.includes("cleaned up") ||
        errorObj.message.includes("not found")
      ) {
        try {
          await loadRadio(radio);
          if (soundIdRef.current) {
            await audioManager.playSound(soundIdRef.current, state.volume);
            return;
          }
        } catch (reloadError) {
          // If reload also fails, fall through to error handling
          const reloadErrorObj =
            reloadError instanceof Error
              ? reloadError
              : new Error("Reload failed");
          setState((prev) => ({
            ...prev,
            error: {
              message: reloadErrorObj.message,
              code: "PLAY_ERROR",
              timestamp: Date.now(),
            },
          }));
          return;
        }
      }

      setState((prev) => ({
        ...prev,
        error: {
          message: errorObj.message,
          code: "PLAY_ERROR",
          timestamp: Date.now(),
        },
      }));
    }
  }, [audioManager, state.volume, radio, loadRadio]);

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
