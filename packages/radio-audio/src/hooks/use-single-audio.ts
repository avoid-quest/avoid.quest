import { AudioManager, type Radio } from "@avoid.quest/cacophony";
import { useCallback, useEffect, useRef, useState } from "react";

const TRANSITION_DURATION = 2000;

export function useSingleAudio(settings?: {
  player: { single?: { transitionDuration?: number; lastUsedRadio?: Radio } };
}) {
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
  const hasInitializedRef = useRef(false);
  const loadRadioRef = useRef<((radio: Radio) => Promise<void>) | null>(null);

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

  // Note: Settings persistence should be handled by the consuming app
  // This is just a placeholder callback
  const saveRadioToSettings = useCallback(async (_radio: Radio) => {
    // Settings persistence handled externally
  }, []);

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

  // Keep ref updated with latest loadRadio function
  useEffect(() => {
    loadRadioRef.current = loadRadio;
  }, [loadRadio]);

  // Play function
  const play = useCallback(async () => {
    // Always recreate the sound before playing (like DJ mode does)
    // This ensures we have a fresh, valid sound and avoids "cleaned up" errors
    if (!currentRadio) {
      return;
    }

    // Skip redundant playSound() if the radio is already playing or crossfading
    // This avoids duplicating playSound() and interrupting the crossfade
    if (isPlaying || isCrossfading) {
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
  }, [audioManager, volume, currentRadio, loadRadio, isPlaying, isCrossfading]);

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

  // Load initial radio if provided
  useEffect(() => {
    const initialRadio = settings?.player.single?.lastUsedRadio;
    if (
      initialRadio &&
      !currentRadio &&
      !hasInitializedRef.current &&
      loadRadioRef.current
    ) {
      hasInitializedRef.current = true;
      loadRadioRef.current(initialRadio);
    }
  }, [settings?.player.single?.lastUsedRadio, currentRadio]);

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
