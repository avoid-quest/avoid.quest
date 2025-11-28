import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../../db";
import type { Radio } from "../../types";
import { AudioManager } from "../audio-manager";

const TRANSITION_DURATION = 2000;

export function useSingleAudio() {
  const settings = useLiveQuery(() => db.settings.limit(1).toArray())?.[0];
  const audioManager = AudioManager.getInstance();

  const [currentRadio, setCurrentRadio] = useState<Radio | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCrossfading, setIsCrossfading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(1);

  const currentSoundIdRef = useRef<string | null>(null);
  const previousSoundIdRef = useRef<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Generate unique sound ID
  const getSoundId = useCallback(
    (radio: Radio) => `single_${radio.id || radio.name}_${Date.now()}`,
    []
  );

  // Cleanup function
  const cleanup = useCallback(async () => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (currentSoundIdRef.current) {
      await audioManager.cleanupSound(currentSoundIdRef.current);
      currentSoundIdRef.current = null;
    }

    if (previousSoundIdRef.current) {
      await audioManager.cleanupSound(previousSoundIdRef.current);
      previousSoundIdRef.current = null;
    }

    setIsPlaying(false);
    setIsCrossfading(false);
    setError(null);
  }, [audioManager]);

  // Helper: Clean up previous sounds without resetting state
  const cleanupPreviousSounds = useCallback(async () => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    const oldSoundId = currentSoundIdRef.current;
    if (oldSoundId) {
      await audioManager.cleanupSound(oldSoundId);
    }
    if (previousSoundIdRef.current) {
      await audioManager.cleanupSound(previousSoundIdRef.current);
      previousSoundIdRef.current = null;
    }
  }, [audioManager]);

  // Helper: Subscribe to sound state changes
  const subscribeToSound = useCallback(
    (soundId: string) => {
      unsubscribeRef.current = audioManager.subscribe(soundId, (state) => {
        setIsPlaying(state.isPlaying);
        setIsLoading(state.isLoading);
        if (state.error) {
          setError(state.error.message);
        }
      });
    },
    [audioManager]
  );

  // Helper: Save radio to settings
  const saveRadioToSettings = useCallback(
    async (radio: Radio) => {
      if (!settings?.id) {
        return;
      }

      await db.settings.update(settings.id, {
        player: {
          ...settings.player,
          single: {
            transitionDuration:
              settings.player.single?.transitionDuration ?? TRANSITION_DURATION,
            lastUsedRadio: radio,
          },
        },
      });
    },
    [settings]
  );

  // Crossfade to new radio
  const crossfadeToNewRadio = useCallback(
    async (newRadio: Radio, newSoundId: string) => {
      const transitionDuration =
        settings?.player.single?.transitionDuration ?? TRANSITION_DURATION;

      try {
        setError(null);
        setIsCrossfading(true);

        // Store previous sound for crossfade
        if (currentSoundIdRef.current) {
          previousSoundIdRef.current = currentSoundIdRef.current;
        }

        // Create new sound
        await audioManager.createSound(newRadio, newSoundId);

        // Unsubscribe from previous sound if exists
        if (unsubscribeRef.current) {
          unsubscribeRef.current();
          unsubscribeRef.current = null;
        }

        // Subscribe to new sound state changes
        subscribeToSound(newSoundId);

        // Start new sound at volume 0 for crossfade
        await audioManager.playSound(newSoundId, 0);

        // Update current references
        currentSoundIdRef.current = newSoundId;
        setCurrentRadio(newRadio);

        // Start crossfade
        if (previousSoundIdRef.current) {
          await audioManager.crossfade(
            previousSoundIdRef.current,
            newSoundId,
            transitionDuration,
            volume
          );
        } else {
          // No previous sound, just set the volume to target
          audioManager.setVolume(newSoundId, volume);
        }

        // Clean up previous sound
        if (previousSoundIdRef.current) {
          await audioManager.cleanupSound(previousSoundIdRef.current);
          previousSoundIdRef.current = null;
        }

        setIsCrossfading(false);
        setIsPlaying(true);

        // Save to settings
        await saveRadioToSettings(newRadio);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Crossfade failed";
        setError(errorMessage);
        setIsCrossfading(false);
      }
    },
    [audioManager, settings, volume, subscribeToSound, saveRadioToSettings]
  );

  // Load radio
  const loadRadio = useCallback(
    async (radio: Radio) => {
      try {
        setError(null);
        const soundId = getSoundId(radio);

        // If we have a current radio that's playing, do crossfade
        if (currentRadio && isPlaying && currentSoundIdRef.current) {
          await crossfadeToNewRadio(radio, soundId);
          return;
        }

        // Otherwise, just load the new radio
        await cleanupPreviousSounds();

        // Create new sound
        await audioManager.createSound(radio, soundId);

        // Subscribe to state changes
        subscribeToSound(soundId);

        currentSoundIdRef.current = soundId;
        setCurrentRadio(radio);

        // Save to settings
        await saveRadioToSettings(radio);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to load radio";
        setError(errorMessage);
      }
    },
    [
      audioManager,
      getSoundId,
      currentRadio,
      isPlaying,
      crossfadeToNewRadio,
      cleanupPreviousSounds,
      subscribeToSound,
      saveRadioToSettings,
    ]
  );

  // Play function
  const play = useCallback(async () => {
    // Always recreate the sound before playing (like DJ mode does)
    // This ensures we have a fresh, valid sound and avoids "cleaned up" errors
    if (!currentRadio) {
      return;
    }

    try {
      // Recreate the sound before playing to ensure it's fresh and valid
      // This matches the pattern used in DJ mode's playLeft/playRight
      await loadRadio(currentRadio);

      // After recreation, check if we have a valid sound ID
      if (!currentSoundIdRef.current) {
        return;
      }

      // Loading state will be managed by AudioManager through subscription
      await audioManager.playSound(currentSoundIdRef.current, volume);
    } catch (err) {
      // Error handling - AudioManager will also update state through subscription
      const errorMessage = err instanceof Error ? err.message : "Play failed";
      setError(errorMessage);
    }
  }, [audioManager, volume, currentRadio, loadRadio]);

  // Pause function
  const pause = useCallback(() => {
    if (!currentSoundIdRef.current) {
      return;
    }
    audioManager.pauseSound(currentSoundIdRef.current);
  }, [audioManager]);

  // Stop function
  const stop = useCallback(() => {
    if (!currentSoundIdRef.current) {
      return;
    }
    audioManager.stopSound(currentSoundIdRef.current);
  }, [audioManager]);

  // Toggle play/pause
  const togglePlayPause = useCallback(async () => {
    if (isPlaying) {
      pause();
    } else {
      await play();
    }
  }, [isPlaying, play, pause]);

  // Set volume
  const setVolumeCallback = useCallback(
    (newVolume: number) => {
      setVolume(newVolume);
      if (currentSoundIdRef.current) {
        audioManager.setVolume(currentSoundIdRef.current, newVolume);
      }
    },
    [audioManager]
  );

  // Load last used radio on mount
  useEffect(() => {
    if (settings?.player.single?.lastUsedRadio && !currentRadio) {
      loadRadio(settings.player.single.lastUsedRadio);
    }
  }, [settings, currentRadio, loadRadio]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      cleanup();
    },
    [cleanup]
  );

  return {
    currentRadio,
    isPlaying,
    isLoading,
    isCrossfading,
    error,
    volume,
    selectRadio: loadRadio,
    togglePlayPause,
    setVolume: setVolumeCallback,
    play,
    pause,
    stop,
  };
}
