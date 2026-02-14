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

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isSameStation(a: Radio, b: Radio): boolean {
  if (a.id !== undefined && b.id !== undefined) {
    return String(a.id) === String(b.id);
  }
  return a.streamUrl === b.streamUrl;
}

export function useSingleAudio(transitionDuration?: number) {
  const [currentRadio, setCurrentRadio] = useState<Radio | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCrossfading, setIsCrossfading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(1);

  const currentPlayerRef = useRef<HTML5AudioPlayer | null>(null);
  const crossfadeControllerRef = useRef<CrossfadeController | null>(null);
  const volumeRef = useRef(volume);
  const isCrossfadingRef = useRef(false);

  // Get or create crossfade controller
  const getCrossfadeController = useCallback(() => {
    if (!crossfadeControllerRef.current) {
      const context = getCrossfadeContext();
      crossfadeControllerRef.current = new CrossfadeController(context);
    }
    return crossfadeControllerRef.current;
  }, []);

  const setCrossfadeState = useCallback((value: boolean) => {
    isCrossfadingRef.current = value;
    setIsCrossfading(value);
  }, []);

  const canUseWebAudio = useCallback((player: HTML5AudioPlayer): boolean => {
    return player.element.crossOrigin === "anonymous";
  }, []);

  const detachPlayerFromGraph = useCallback((player: HTML5AudioPlayer) => {
    const controller = crossfadeControllerRef.current;
    if (controller?.hasConnection(player.id)) {
      controller.disconnect(player.id);
    }
  }, []);

  const attachPlayerToGraph = useCallback(
    (player: HTML5AudioPlayer, gainValue: number): boolean => {
      if (!canUseWebAudio(player)) {
        detachPlayerFromGraph(player);
        return false;
      }

      const controller = getCrossfadeController();
      controller.connect(player);

      // When routed through Web Audio, keep element volume at unity and use gain node.
      player.setVolume(1);
      controller.setGain(player.id, clampVolume(gainValue));
      return true;
    },
    [canUseWebAudio, detachPlayerFromGraph, getCrossfadeController]
  );

  const setPlayerLevel = useCallback(
    (player: HTML5AudioPlayer, level: number, viaGraph: boolean): void => {
      const clamped = clampVolume(level);
      if (viaGraph) {
        const controller = crossfadeControllerRef.current;
        player.setVolume(1);
        controller?.setGain(player.id, clamped);
        return;
      }
      player.setVolume(clamped);
    },
    []
  );

  const getGraphGain = useCallback((player: HTML5AudioPlayer): number => {
    const controller = crossfadeControllerRef.current;
    if (!controller?.hasConnection(player.id)) {
      return 0;
    }
    return controller.getGain(player.id) ?? 0;
  }, []);

  const runCrossfadeTransition = useCallback(
    async (params: {
      outgoing: HTML5AudioPlayer;
      incoming: HTML5AudioPlayer;
      duration: number;
      targetVolume: number;
      outgoingViaGraph: boolean;
      incomingViaGraph: boolean;
    }) => {
      const {
        outgoing,
        incoming,
        duration,
        targetVolume,
        outgoingViaGraph,
        incomingViaGraph,
      } = params;

      const clampedTarget = clampVolume(targetVolume);
      const outgoingStart = outgoingViaGraph
        ? getGraphGain(outgoing)
        : outgoing.volume;

      if (duration <= 0) {
        setPlayerLevel(outgoing, 0, outgoingViaGraph);
        setPlayerLevel(incoming, clampedTarget, incomingViaGraph);
        return;
      }

      await new Promise<void>((resolve) => {
        const start = performance.now();

        const step = (now: number) => {
          const elapsed = now - start;
          const progress = Math.min(elapsed / duration, 1);

          // Equal-power crossfade avoids the perceived volume dip at midpoint.
          const fadeOut = Math.cos(progress * 0.5 * Math.PI);
          const fadeIn = Math.sin(progress * 0.5 * Math.PI);

          setPlayerLevel(outgoing, outgoingStart * fadeOut, outgoingViaGraph);
          setPlayerLevel(incoming, clampedTarget * fadeIn, incomingViaGraph);

          if (progress >= 1) {
            resolve();
            return;
          }

          requestAnimationFrame(step);
        };

        requestAnimationFrame(step);
      });
    },
    [getGraphGain, setPlayerLevel]
  );

  const disposePlayer = useCallback(
    (player: HTML5AudioPlayer | null) => {
      if (!player) {
        return;
      }

      detachPlayerFromGraph(player);
      player.dispose();
    },
    [detachPlayerFromGraph]
  );

  // Generate unique player ID
  const getPlayerId = useCallback(
    (radio: Radio) => `single_${radio.id || radio.name}_${Date.now()}`,
    []
  );

  // Cleanup function
  const cleanup = useCallback(() => {
    disposePlayer(currentPlayerRef.current);
    currentPlayerRef.current = null;

    crossfadeControllerRef.current?.dispose();
    crossfadeControllerRef.current = null;

    setIsPlaying(false);
    setCrossfadeState(false);
    setError(null);
  }, [disposePlayer, setCrossfadeState]);

  // Helper: Clean up previous players without resetting state
  const cleanupPreviousPlayers = useCallback(() => {
    disposePlayer(currentPlayerRef.current);
    currentPlayerRef.current = null;
  }, [disposePlayer]);

  // Helper: Subscribe to player state changes
  const subscribeToPlayer = useCallback(
    (player: HTML5AudioPlayer) =>
      player.subscribe((state) => {
        setIsPlaying(state.isPlaying);
        setIsLoading(state.isLoading);
        setError(state.error?.message ?? null);
      }),
    []
  );

  // Crossfade to new radio
  const crossfadeToNewRadio = useCallback(
    async (newRadio: Radio, newPlayerId: string) => {
      const duration = transitionDuration ?? DEFAULT_TRANSITION_DURATION;
      const outgoingPlayer = currentPlayerRef.current;
      if (!outgoingPlayer) {
        return;
      }

      const targetVolume = clampVolume(volumeRef.current);
      let incomingPlayer: HTML5AudioPlayer | null = null;

      try {
        setError(null);
        setCrossfadeState(true);

        // Resume audio context on user gesture
        await resumeCrossfadeContext();

        incomingPlayer = new HTML5AudioPlayer(newPlayerId, newRadio, {
          telemetryMode: "single",
        });
        currentPlayerRef.current = incomingPlayer;

        // Subscribe before playback so loading/error state for incoming is tracked.
        subscribeToPlayer(incomingPlayer);

        // Start incoming silent, then transition by graph gain or element volume.
        await incomingPlayer.play(0);

        const outgoingViaGraph = attachPlayerToGraph(
          outgoingPlayer,
          targetVolume
        );
        const incomingViaGraph = attachPlayerToGraph(incomingPlayer, 0);

        setCurrentRadio(newRadio);

        await runCrossfadeTransition({
          outgoing: outgoingPlayer,
          incoming: incomingPlayer,
          duration,
          targetVolume,
          outgoingViaGraph,
          incomingViaGraph,
        });

        outgoingPlayer.stop();
        disposePlayer(outgoingPlayer);

        setCrossfadeState(false);
        setIsPlaying(true);
        setIsLoading(false);

        // Apply latest volume in case it changed during transition.
        setPlayerLevel(
          incomingPlayer,
          clampVolume(volumeRef.current),
          incomingViaGraph
        );
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

        // Restore previous player as current when incoming transition fails.
        if (incomingPlayer) {
          disposePlayer(incomingPlayer);
        }

        currentPlayerRef.current = outgoingPlayer;
        setCurrentRadio(outgoingPlayer.radio);

        const outgoingViaGraph = attachPlayerToGraph(
          outgoingPlayer,
          clampVolume(volumeRef.current)
        );

        if (!outgoingViaGraph) {
          outgoingPlayer.setVolume(clampVolume(volumeRef.current));
        }

        setCrossfadeState(false);
        setIsPlaying(outgoingPlayer.isPlaying);
        setIsLoading(false);
      }
    },
    [
      transitionDuration,
      setCrossfadeState,
      subscribeToPlayer,
      attachPlayerToGraph,
      runCrossfadeTransition,
      disposePlayer,
      setPlayerLevel,
    ]
  );

  // Load radio (no crossfade, just load for later playback)
  const loadRadio = useCallback(
    async (radio: Radio) => {
      try {
        if (isCrossfadingRef.current) {
          return;
        }

        setError(null);

        // Validate platform radio can be played in single mode
        validateRadioForMode(radio, "single");

        if (currentRadio && isSameStation(currentRadio, radio)) {
          return;
        }

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

        // Keep pre-play volume in sync for non-graph path.
        player.setVolume(clampVolume(volumeRef.current));
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
    if (isPlaying || isCrossfadingRef.current) {
      return;
    }

    try {
      // Resume audio context on user gesture
      await resumeCrossfadeContext();

      let player = currentPlayerRef.current;
      if (!player) {
        // Need to create a new player
        await loadRadio(currentRadio);
        player = currentPlayerRef.current;
      }

      if (!player) {
        return;
      }

      // Play with full element volume first; then route output path deterministically.
      await player.play(1);

      const target = clampVolume(volumeRef.current);
      const routedToGraph = attachPlayerToGraph(player, target);
      if (!routedToGraph) {
        player.setVolume(target);
      }

      setError(null);
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
  }, [currentRadio, loadRadio, isPlaying, attachPlayerToGraph]);

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
  const setVolumeCallback = useCallback(
    (newVolume: number) => {
      const clampedVolume = clampVolume(newVolume);
      setVolume(clampedVolume);
      volumeRef.current = clampedVolume;

      // Skip gain updates during crossfade to avoid cancelling transition ramps.
      if (isCrossfadingRef.current) {
        return;
      }

      const player = currentPlayerRef.current;
      if (!player) {
        return;
      }

      const controller = crossfadeControllerRef.current;
      if (controller?.hasConnection(player.id) && canUseWebAudio(player)) {
        player.setVolume(1);
        controller.setGain(player.id, clampedVolume);
        return;
      }

      detachPlayerFromGraph(player);
      player.setVolume(clampedVolume);
    },
    [canUseWebAudio, detachPlayerFromGraph]
  );

  // Keep ref synchronized if volume is updated externally.
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

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
