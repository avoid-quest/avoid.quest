import type { StateCreator } from "zustand";
import type { Radio } from "@/lib/types";
import { getAudioManager, getSoundId } from "./audio-manager-helpers";
import { applyCrossfade } from "./mixer-actions";
import { findNextTrack } from "./track-actions";
import type { DjState } from "./types";
import { initialDeckState } from "./types";

// Track subscriptions to clean them up properly
let leftSubscriptionCleanup: (() => void) | null = null;
let rightSubscriptionCleanup: (() => void) | null = null;

export const createDeckActions: StateCreator<
  DjState,
  [],
  [],
  Pick<
    DjState,
    | "setLeftRadio"
    | "setRightRadio"
    | "playLeft"
    | "pauseLeft"
    | "playRight"
    | "pauseRight"
    | "setLeftVolume"
    | "setRightVolume"
    | "setLeftMute"
    | "setRightMute"
  >
> = (set, get) => ({
  setLeftRadio: async (radio: Radio | null) => {
    const { leftDeck } = get();

    // Unsubscribe from previous subscription
    if (leftSubscriptionCleanup) {
      leftSubscriptionCleanup();
      leftSubscriptionCleanup = null;
    }

    // Cleanup existing sound
    if (leftDeck.soundId) {
      await getAudioManager().cleanupSound(leftDeck.soundId);
    }

    if (!radio) {
      set((_state) => ({
        leftDeck: { ...initialDeckState },
      }));
      return;
    }

    const soundId = getSoundId(radio, "left");

    try {
      set((state) => ({
        leftDeck: { ...state.leftDeck, isLoading: true, error: null },
      }));

      await getAudioManager().createSound(radio, soundId);

      set((state) => ({
        leftDeck: {
          ...state.leftDeck,
          radio,
          soundId,
          isLoading: false,
        },
      }));

      // Subscribe to this sound's events and store cleanup function
      leftSubscriptionCleanup = getAudioManager().subscribe(
        soundId,
        (audioState) => {
          const currentState = get();

          // Detect track end using explicit flag
          const trackEnded = audioState.hasEnded;

          // Only update if state actually changed to prevent unnecessary re-renders
          if (
            currentState.leftDeck.isPlaying !== audioState.isPlaying ||
            currentState.leftDeck.isLoading !== audioState.isLoading
          ) {
            set((state) => ({
              leftDeck: {
                ...state.leftDeck,
                isPlaying: audioState.isPlaying,
                isLoading: audioState.isLoading,
              },
              error: audioState.error ? audioState.error.message : state.error,
            }));
          }

          // Handle track end - auto-advance to next track
          if (trackEnded) {
            const nextTrack = findNextTrack(currentState.leftDeck.radio);
            if (nextTrack && currentState.leftDeck.radio) {
              // Load next track asynchronously
              get().loadTrack(
                "left",
                {
                  ...currentState.leftDeck.radio,
                  streamUrl: nextTrack.streamUrl,
                },
                true // auto-play
              );
            }
          }
        }
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load left deck";
      set((state) => ({
        error: msg,
        leftDeck: { ...state.leftDeck, isLoading: false },
      }));
    }
  },

  setRightRadio: async (radio: Radio | null) => {
    const { rightDeck } = get();

    // Unsubscribe from previous subscription
    if (rightSubscriptionCleanup) {
      rightSubscriptionCleanup();
      rightSubscriptionCleanup = null;
    }

    // Cleanup existing sound
    if (rightDeck.soundId) {
      await getAudioManager().cleanupSound(rightDeck.soundId);
    }

    if (!radio) {
      set((_state) => ({
        rightDeck: { ...initialDeckState },
      }));
      return;
    }

    const soundId = getSoundId(radio, "right");

    try {
      set((state) => ({
        rightDeck: { ...state.rightDeck, isLoading: true, error: null },
      }));

      await getAudioManager().createSound(radio, soundId);

      set((state) => ({
        rightDeck: {
          ...state.rightDeck,
          radio,
          soundId,
          isLoading: false,
        },
      }));

      // Subscribe to this sound's events and store cleanup function
      rightSubscriptionCleanup = getAudioManager().subscribe(
        soundId,
        (audioState) => {
          const currentState = get();

          // Detect track end using explicit flag
          const trackEnded = audioState.hasEnded;

          // Only update if state actually changed to prevent unnecessary re-renders
          if (
            currentState.rightDeck.isPlaying !== audioState.isPlaying ||
            currentState.rightDeck.isLoading !== audioState.isLoading
          ) {
            set((state) => ({
              rightDeck: {
                ...state.rightDeck,
                isPlaying: audioState.isPlaying,
                isLoading: audioState.isLoading,
              },
              error: audioState.error ? audioState.error.message : state.error,
            }));
          }

          // Handle track end - auto-advance to next track
          if (trackEnded) {
            const nextTrack = findNextTrack(currentState.rightDeck.radio);
            if (nextTrack && currentState.rightDeck.radio) {
              // Load next track asynchronously
              get().loadTrack(
                "right",
                {
                  ...currentState.rightDeck.radio,
                  streamUrl: nextTrack.streamUrl,
                },
                true // auto-play
              );
            }
          }
        }
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load right deck";
      set((state) => ({
        error: msg,
        rightDeck: { ...state.rightDeck, isLoading: false },
      }));
    }
  },

  playLeft: async () => {
    const { leftDeck } = get();
    if (leftDeck.soundId && !leftDeck.isPlaying) {
      try {
        await getAudioManager().playSound(leftDeck.soundId, leftDeck.volume);
        applyCrossfade(get);
      } catch (err) {
        set({
          error: err instanceof Error ? err.message : "Failed to play left",
        });
      }
    }
  },

  pauseLeft: () => {
    const { leftDeck } = get();
    if (leftDeck.soundId) {
      getAudioManager().pauseSound(leftDeck.soundId);
    }
  },

  playRight: async () => {
    const { rightDeck } = get();
    if (rightDeck.soundId && !rightDeck.isPlaying) {
      try {
        await getAudioManager().playSound(rightDeck.soundId, rightDeck.volume);
        applyCrossfade(get);
      } catch (err) {
        set({
          error: err instanceof Error ? err.message : "Failed to play right",
        });
      }
    }
  },

  pauseRight: () => {
    const { rightDeck } = get();
    if (rightDeck.soundId) {
      getAudioManager().pauseSound(rightDeck.soundId);
    }
  },

  setLeftVolume: (volume: number) => {
    set((state) => ({
      leftDeck: { ...state.leftDeck, volume },
    }));
    applyCrossfade(get);
  },

  setRightVolume: (volume: number) => {
    set((state) => ({
      rightDeck: { ...state.rightDeck, volume },
    }));
    applyCrossfade(get);
  },

  setLeftMute: (muted: boolean) => {
    const { leftDeck } = get();
    set((state) => ({
      leftDeck: { ...state.leftDeck, muted },
    }));
    if (leftDeck.soundId) {
      if (muted) {
        getAudioManager().muteSound(leftDeck.soundId);
      } else {
        getAudioManager().unmuteSound(leftDeck.soundId);
      }
    }
  },

  setRightMute: (muted: boolean) => {
    const { rightDeck } = get();
    set((state) => ({
      rightDeck: { ...state.rightDeck, muted },
    }));
    if (rightDeck.soundId) {
      if (muted) {
        getAudioManager().muteSound(rightDeck.soundId);
      } else {
        getAudioManager().unmuteSound(rightDeck.soundId);
      }
    }
  },
});
