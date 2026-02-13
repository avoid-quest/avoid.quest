/**
 * useSingleAudio Hook
 *
 * Single player audio hook with crossfading support for smooth transitions.
 * Uses HTML5 Audio + Web Audio API for crossfade (no worklets).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { validateRadioForMode } from "@/lib/external-url/utils";
import { capturePlaybackError } from "@/lib/telemetry/playback-errors";

import {
  CrossfadeController,
  getCrossfadeContext,
  HTML5AudioPlayer,
  resumeCrossfadeContext,
} from "../html5/index.js";
import type { Radio } from "../playback/types.js";

const DEFAULT_TRANSITION_DURATION = 2000;

export function useSingleAudio(transitionDuration?: number) {
  const [currentRadio, setCurrentRadio] = useState<Radio | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCrossfading, setIsCrossfading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(1);

  const currentPlayerRef = useRef<HTML5AudioPlayer | null>(null);
  const previousPlayerRef = useRef<HTML5AudioPlayer | null>(null);
  const crossfadeControllerRef = useRef<CrossfadeController | null>(null);
  const volumeRef = useRef(volume);

  // Get or create crossfade controller
  const getCrossfadeController = useCallback(() => {
    if (!crossfadeControllerRef.current) {
      const context = getCrossfadeContext();
      crossfadeControllerRef.current = new CrossfadeController(context);
    }
    return crossfadeControllerRef.current;
  }, []);

  // Generate unique player ID
  const getPlayerId = useCallback(
    (radio: Radio) => `single_${radio.id || radio.name}_${Date.now()}`,
    []
  );

  // Cleanup function
  const cleanup = useCallback(() => {
    currentPlayerRef.current?.dispose();
    currentPlayerRef.current = null;

    previousPlayerRef.current?.dispose();
    previousPlayerRef.current = null;

    crossfadeControllerRef.current?.dispose();
    crossfadeControllerRef.current = null;

    setIsPlaying(false);
    setIsCrossfading(false);
    setError(null);
  }, []);

  // Helper: Clean up previous players without resetting state
  const cleanupPreviousPlayers = useCallback(() => {
    if (previousPlayerRef.current) {
      previousPlayerRef.current.dispose();
      previousPlayerRef.current = null;
    }
    if (currentPlayerRef.current) {
      currentPlayerRef.current.dispose();
      currentPlayerRef.current = null;
    }
  }, []);

  // Helper: Subscribe to player state changes
  const subscribeToPlayer = useCallback(
    (player: HTML5AudioPlayer) =>
      player.subscribe((state) => {
        setIsPlaying(state.isPlaying);
        setIsLoading(state.isLoading);
        if (state.error) {
          setError(state.error.message);
        }
      }),
    []
  );

  // Crossfade to new radio
  const crossfadeToNewRadio = useCallback(
    async (newRadio: Radio, newPlayerId: string) => {
      const duration = transitionDuration ?? DEFAULT_TRANSITION_DURATION;

      try {
        setError(null);
        setIsCrossfading(true);

        // Resume audio context on user gesture
        await resumeCrossfadeContext();

        const controller = getCrossfadeController();

        // Store previous player for crossfade
        previousPlayerRef.current = currentPlayerRef.current;

        // Create new player
        const newPlayer = new HTML5AudioPlayer(newPlayerId, newRadio, {
          telemetryMode: "single",
        });
        currentPlayerRef.current = newPlayer;
        setCurrentRadio(newRadio);

        // Connect new player to crossfade controller
        controller.connect(newPlayer);

        // Start new player at volume 0 (crossfade controller manages gain)
        await newPlayer.play(0);

        // Wait for audio to be ready before starting crossfade
        // This ensures smooth transitions without volume gaps
        await new Promise<void>((resolve) => {
          const element = newPlayer.element;
          // readyState >= 3 means HAVE_FUTURE_DATA (enough data to start playing)
          if (element.readyState >= 3) {
            resolve();
            return;
          }

          const onCanPlay = () => {
            element.removeEventListener("canplay", onCanPlay);
            resolve();
          };
          element.addEventListener("canplay", onCanPlay);
        });

        // Subscribe to new player state changes
        const unsubscribe = subscribeToPlayer(newPlayer);

        // Perform crossfade
        await controller.crossfade(previousPlayerRef.current, newPlayer, {
          duration,
          targetVolume: volume,
        });

        // Clean up previous player
        if (previousPlayerRef.current) {
          previousPlayerRef.current.dispose();
          previousPlayerRef.current = null;
        }

        setIsCrossfading(false);
        setIsPlaying(true);

        // Apply any volume changes that occurred during crossfade
        const currentVolume = volumeRef.current;
        newPlayer.setVolume(currentVolume);
        controller.setGain(newPlayer.id, currentVolume);

        // Return cleanup function
        return unsubscribe;
      } catch (err) {
        console.error("[useSingleAudio] Crossfade failed:", err);
        const errorMessage =
          err instanceof Error ? err.message : "Crossfade failed";
        setError(errorMessage);
        capturePlaybackError(err, {
          mode: "single",
          radioId: newRadio.id,
          radioName: newRadio.name,
          streamUrl: newRadio.streamUrl,
          errorCode: "SINGLE_CROSSFADE_FAILED",
          errorMessage,
          retryPhase: "none",
        });
        setIsCrossfading(false);
        // biome-ignore lint/suspicious/noEmptyBlockStatements: noop unsubscribe
        return () => {};
      }
    },
    [transitionDuration, volume, getCrossfadeController, subscribeToPlayer]
  );

  // Load radio (no crossfade, just load for later playback)
  const loadRadio = useCallback(
    async (radio: Radio) => {
      try {
        setError(null);

        // Validate platform radio can be played in single mode
        validateRadioForMode(radio, "single");

        const playerId = getPlayerId(radio);

        // If we have a current radio that's playing, do crossfade
        if (currentRadio && isPlaying && currentPlayerRef.current) {
          await crossfadeToNewRadio(radio, playerId);
          return;
        }

        // Otherwise, just load the new radio
        cleanupPreviousPlayers();

        // Create new player
        const player = new HTML5AudioPlayer(playerId, radio, {
          telemetryMode: "single",
        });
        currentPlayerRef.current = player;
        setCurrentRadio(radio);

        // Subscribe to state changes
        subscribeToPlayer(player);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to load radio";
        setError(errorMessage);
        capturePlaybackError(err, {
          mode: "single",
          radioId: radio.id,
          radioName: radio.name,
          streamUrl: radio.streamUrl,
          errorCode: "SINGLE_LOAD_FAILED",
          errorMessage,
          retryPhase: "none",
        });
      }
    },
    [
      getPlayerId,
      currentRadio,
      isPlaying,
      crossfadeToNewRadio,
      cleanupPreviousPlayers,
      subscribeToPlayer,
    ]
  );

  // Play function
  const play = useCallback(async () => {
    if (!currentRadio) {
      return;
    }

    // Skip redundant play if already playing or crossfading
    if (isPlaying || isCrossfading) {
      return;
    }

    try {
      // Resume audio context on user gesture
      await resumeCrossfadeContext();

      const player = currentPlayerRef.current;
      if (!player) {
        // Need to create a new player
        await loadRadio(currentRadio);
        const newPlayer = currentPlayerRef.current;
        if (newPlayer) {
          await newPlayer.play(volume);
        }
        return;
      }

      await player.play(volume);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Play failed";
      setError(errorMessage);
      capturePlaybackError(err, {
        mode: "single",
        radioId: currentRadio.id,
        radioName: currentRadio.name,
        streamUrl: currentRadio.streamUrl,
        errorCode: "SINGLE_PLAY_FAILED",
        errorMessage,
        retryPhase: "none",
      });
    }
  }, [currentRadio, loadRadio, isPlaying, isCrossfading, volume]);

  // Pause function
  const pause = useCallback(() => {
    currentPlayerRef.current?.pause();
  }, []);

  // Stop function
  const stop = useCallback(() => {
    currentPlayerRef.current?.stop();
  }, []);

  // Toggle play/pause
  const togglePlayPause = useCallback(async () => {
    if (isPlaying) {
      pause();
    } else {
      await play();
    }
  }, [isPlaying, play, pause]);

  // Set volume
  // Use ref to avoid stale closure in useCallback while avoiding unnecessary re-renders
  const isCrossfadingRef = useRef(isCrossfading);
  useEffect(() => {
    isCrossfadingRef.current = isCrossfading;
  }, [isCrossfading]);

  const setVolumeCallback = useCallback((newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolume(clampedVolume);
    volumeRef.current = clampedVolume;

    // Skip actual gain updates during crossfade to avoid cancelling Web Audio ramps
    // Volume will be applied after crossfade completes
    if (isCrossfadingRef.current) {
      return;
    }

    // Update current player volume
    currentPlayerRef.current?.setVolume(clampedVolume);

    // Update crossfade controller gain
    if (currentPlayerRef.current && crossfadeControllerRef.current) {
      crossfadeControllerRef.current.setGain(
        currentPlayerRef.current.id,
        clampedVolume
      );
    }
  }, []);

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
