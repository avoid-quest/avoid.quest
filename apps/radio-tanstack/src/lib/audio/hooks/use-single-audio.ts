"use client";

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

  // Generate unique sound ID
  const getSoundId = useCallback(
    (radio: Radio) => `single_${radio.id || radio.name}_${Date.now()}`,
    []
  );

  // Cleanup function
  const cleanup = useCallback(async () => {
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

        // Subscribe to new sound state changes
        const _unsubscribe = audioManager.subscribe(newSoundId, (state) => {
          setIsPlaying(state.isPlaying);
          setIsLoading(state.isLoading);
          if (state.error) {
            setError(state.error.message);
          }
        });

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
        if (settings?.id) {
          await db.settings.update(settings.id, {
            player: {
              ...settings.player,
              single: {
                transitionDuration,
                lastUsedRadio: newRadio,
              },
            },
          });
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Crossfade failed";
        setError(errorMessage);
        setIsCrossfading(false);
      }
    },
    [audioManager, settings, volume]
  );

  // Load radio
  const loadRadio = useCallback(
    async (radio: Radio) => {
      try {
        setError(null);
        setIsLoading(true);

        const soundId = getSoundId(radio);

        // If we have a current radio that's playing, do crossfade
        if (currentRadio && isPlaying && currentSoundIdRef.current) {
          setIsLoading(false);
          await crossfadeToNewRadio(radio, soundId);
          return;
        }

        // Otherwise, just load the new radio
        await audioManager.createSound(radio, soundId);

        // Subscribe to state changes
        const _unsubscribe = audioManager.subscribe(soundId, (state) => {
          setIsPlaying(state.isPlaying);
          setIsLoading(state.isLoading);
          if (state.error) {
            setError(state.error.message);
          }
        });

        // Clean up previous audio
        await cleanup();

        currentSoundIdRef.current = soundId;
        setCurrentRadio(radio);
        setIsLoading(false);

        // Save to settings
        if (settings?.id) {
          await db.settings.update(settings.id, {
            player: {
              ...settings.player,
              single: {
                transitionDuration:
                  settings.player.single?.transitionDuration ??
                  TRANSITION_DURATION,
                lastUsedRadio: radio,
              },
            },
          });
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to load radio";
        setError(errorMessage);
        setIsLoading(false);
      }
    },
    [
      audioManager,
      cleanup,
      getSoundId,
      settings,
      currentRadio,
      isPlaying,
      crossfadeToNewRadio,
    ]
  );

  // Play function
  const play = useCallback(async () => {
    if (!currentSoundIdRef.current) {
      return;
    }

    try {
      await audioManager.playSound(currentSoundIdRef.current, volume);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Play failed";
      setError(errorMessage);
    }
  }, [audioManager, volume]);

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
