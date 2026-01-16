/**
 * useMultipleAudio Hook
 *
 * Manages multiple independent HTML5 audio players for "multiple" mode.
 * Each radio plays simultaneously without effects or complex routing.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { validateRadioForMode } from "@/lib/external-url/utils";

import { HTML5AudioManager } from "../html5/index.js";
import type { Radio } from "../playback/types.js";

export type MultipleAudioState = {
  id: string;
  radio: Radio;
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  error: string | null;
};

export type MultipleAudioSettings = {
  player?: {
    multiple?: {
      lastUsedRadios?: Radio[];
    };
  };
};

export function useMultipleAudio(settings?: MultipleAudioSettings) {
  const manager = HTML5AudioManager.getInstance();

  const [players, setPlayers] = useState<MultipleAudioState[]>([]);
  const [globalVolume, setGlobalVolume] = useState(1);
  const [globalMuted, setGlobalMuted] = useState(false);

  const unsubscribesRef = useRef<Map<string, () => void>>(new Map());
  const hasInitializedRef = useRef(false);

  // Generate unique player ID
  const getPlayerId = useCallback(
    (radio: Radio) => `multi_${radio.id || radio.name}_${Date.now()}`,
    []
  );

  // Subscribe to player state changes
  const subscribeToPlayer = useCallback(
    (playerId: string, _radio: Radio) => {
      // Unsubscribe from previous subscription if exists
      const existingUnsubscribe = unsubscribesRef.current.get(playerId);
      if (existingUnsubscribe) {
        existingUnsubscribe();
      }

      const unsubscribe = manager.subscribe(playerId, (state) => {
        setPlayers((prev) => {
          const index = prev.findIndex((p) => p.id === playerId);
          if (index === -1) {
            return prev;
          }

          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            isPlaying: state.isPlaying,
            isLoading: state.isLoading,
            volume: state.volume,
            error: state.error?.message ?? null,
          };
          return updated;
        });
      });

      unsubscribesRef.current.set(playerId, unsubscribe);
    },
    [manager]
  );

  // Add a new radio
  const addRadio = useCallback(
    async (radio: Radio, autoPlay = false) => {
      const playerId = getPlayerId(radio);

      // Validate platform radio can be played in multiple mode
      try {
        validateRadioForMode(radio, "multiple");
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Invalid radio for this mode";
        setPlayers((prev) => [
          ...prev,
          {
            id: playerId,
            radio,
            isPlaying: false,
            isLoading: false,
            volume: 1,
            error: errorMsg,
          },
        ]);
        return playerId;
      }

      manager.createPlayer(radio, playerId);

      // Add to state
      const newPlayer: MultipleAudioState = {
        id: playerId,
        radio,
        isPlaying: false,
        isLoading: autoPlay,
        volume: 1,
        error: null,
      };

      setPlayers((prev) => [...prev, newPlayer]);

      // Subscribe to state changes
      subscribeToPlayer(playerId, radio);

      // Auto play if requested
      if (autoPlay) {
        try {
          await manager.play(playerId);
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Failed to auto-play";
          setPlayers((prev) =>
            prev.map((p) => (p.id === playerId ? { ...p, error: errorMsg } : p))
          );
        }
      }

      return playerId;
    },
    [getPlayerId, manager, subscribeToPlayer]
  );

  // Remove a radio
  const removeRadio = useCallback(
    (playerId: string) => {
      // Unsubscribe
      const unsubscribe = unsubscribesRef.current.get(playerId);
      if (unsubscribe) {
        unsubscribe();
        unsubscribesRef.current.delete(playerId);
      }

      // Remove from manager
      manager.removePlayer(playerId);

      // Remove from state
      setPlayers((prev) => prev.filter((p) => p.id !== playerId));
    },
    [manager]
  );

  // Play a specific radio
  const play = useCallback(
    async (playerId: string) => {
      try {
        await manager.play(playerId);
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Failed to play audio";
        setPlayers((prev) =>
          prev.map((p) => (p.id === playerId ? { ...p, error: errorMsg } : p))
        );
      }
    },
    [manager]
  );

  // Pause a specific radio
  const pause = useCallback(
    (playerId: string) => {
      manager.pause(playerId);
    },
    [manager]
  );

  // Stop a specific radio
  const stop = useCallback(
    (playerId: string) => {
      manager.stop(playerId);
    },
    [manager]
  );

  // Toggle play/pause for a specific radio
  const togglePlayPause = useCallback(
    async (playerId: string) => {
      const playerState = players.find((p) => p.id === playerId);
      if (!playerState) {
        return;
      }

      if (playerState.isPlaying) {
        pause(playerId);
      } else {
        await play(playerId);
      }
    },
    [players, play, pause]
  );

  // Set volume for a specific radio
  const setVolume = useCallback(
    (playerId: string, volume: number) => {
      manager.setVolume(playerId, volume);
    },
    [manager]
  );

  // Set global volume
  const setGlobalVolumeCallback = useCallback(
    (volume: number) => {
      const clampedVolume = Math.max(0, Math.min(1, volume));
      setGlobalVolume(clampedVolume);
      manager.setGlobalVolume(clampedVolume);
    },
    [manager]
  );

  // Toggle global mute
  const toggleGlobalMute = useCallback(() => {
    if (globalMuted) {
      manager.unmuteGlobal();
      setGlobalMuted(false);
    } else {
      manager.muteGlobal();
      setGlobalMuted(true);
    }
  }, [manager, globalMuted]);

  // Play all radios
  const playAll = useCallback(async () => {
    for (const player of players) {
      if (!player.isPlaying) {
        try {
          await manager.play(player.id);
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Failed to play audio";
          setPlayers((prev) =>
            prev.map((p) =>
              p.id === player.id ? { ...p, error: errorMsg } : p
            )
          );
        }
      }
    }
  }, [manager, players]);

  // Pause all radios
  const pauseAll = useCallback(() => {
    for (const player of players) {
      if (player.isPlaying) {
        manager.pause(player.id);
      }
    }
  }, [manager, players]);

  // Stop all radios
  const stopAll = useCallback(() => {
    manager.stopAll();
  }, [manager]);

  // Clear all radios
  const clearAll = useCallback(() => {
    // Unsubscribe from all
    for (const unsubscribe of unsubscribesRef.current.values()) {
      unsubscribe();
    }
    unsubscribesRef.current.clear();

    // Clear manager
    manager.dispose();

    // Clear state
    setPlayers([]);
  }, [manager]);

  // Load initial radios if provided
  useEffect(() => {
    const initialRadios = settings?.player?.multiple?.lastUsedRadios;
    if (
      initialRadios &&
      initialRadios.length > 0 &&
      players.length === 0 &&
      !hasInitializedRef.current
    ) {
      hasInitializedRef.current = true;
      for (const radio of initialRadios) {
        addRadio(radio, false);
      }
    }
  }, [settings?.player?.multiple?.lastUsedRadios, players.length, addRadio]);

  // Cleanup on unmount - dispose all players to stop audio
  useEffect(
    () => () => {
      clearAll();
    },
    [clearAll]
  );

  return {
    players,
    globalVolume,
    globalMuted,
    addRadio,
    removeRadio,
    play,
    pause,
    stop,
    togglePlayPause,
    setVolume,
    setGlobalVolume: setGlobalVolumeCallback,
    toggleGlobalMute,
    playAll,
    pauseAll,
    stopAll,
    clearAll,
  };
}
