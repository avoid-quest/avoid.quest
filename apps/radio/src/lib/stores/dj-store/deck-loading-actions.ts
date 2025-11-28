import type { StateCreator } from "zustand";
import type { Radio } from "@/lib/types";
import { getAudioManager, getSoundId } from "./audio-manager-helpers";
import { applyCrossfade } from "./mixer-actions";
import { findNextTrack } from "./track-actions";
import { type DjState, initialDeckState } from "./types";

// Track subscriptions to clean them up properly
let leftSubscriptionCleanup: (() => void) | null = null;
let rightSubscriptionCleanup: (() => void) | null = null;

/**
 * Helper to apply stored effects and filters to a newly loaded sound
 */
function applyStoredEffectsAndFilters(
  soundId: string,
  effects: DjState["leftDeck"]["effects"],
  filter: DjState["leftDeck"]["filter"]
) {
  // Apply stored filter if enabled
  if (filter.enabled) {
    getAudioManager().updateFilter(soundId, filter);
  }

  // Apply stored effects
  for (const effect of effects) {
    getAudioManager().addEffect(soundId, effect);
  }
}

export const createDeckLoadingActions: StateCreator<
  DjState,
  [],
  [],
  Pick<
    DjState,
    "setLeftRadio" | "setRightRadio" | "resetLeft" | "resetRight" | "cleanupAll"
  >
> = (set, get) => ({
  cleanupAll: async () => {
    const { setLeftRadio, setRightRadio } = get();
    // Setting radio to null triggers cleanup logic in setRadio actions
    await Promise.all([setLeftRadio(null), setRightRadio(null)]);
  },

  setLeftRadio: async (radio: Radio | null) => {
    const { leftDeck } = get();

    // Preserve the playing state before cleanup
    const wasPlaying = leftDeck.isPlaying;

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
        leftDeck: { ...state.leftDeck, error: null },
      }));

      // Loading state will be managed by AudioManager through subscription
      await getAudioManager().createSound(radio, soundId);

      set((state) => ({
        leftDeck: {
          ...state.leftDeck,
          radio,
          soundId,
        },
      }));

      // Apply stored filter and effects
      const freshState = get();
      applyStoredEffectsAndFilters(
        soundId,
        freshState.leftDeck.effects,
        freshState.leftDeck.filter
      );

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

      // If the previous radio was playing, auto-play the new one
      if (wasPlaying) {
        await getAudioManager().playSound(soundId, leftDeck.volume);
        applyCrossfade(get);
      }
    } catch (err) {
      // Error handling - AudioManager will also update state through subscription
      const msg =
        err instanceof Error ? err.message : "Failed to load left deck";
      set((_state) => ({
        error: msg,
      }));
    }
  },

  setRightRadio: async (radio: Radio | null) => {
    const { rightDeck } = get();

    // Preserve the playing state before cleanup
    const wasPlaying = rightDeck.isPlaying;

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
        rightDeck: { ...state.rightDeck, error: null },
      }));

      // Loading state will be managed by AudioManager through subscription
      await getAudioManager().createSound(radio, soundId);

      set((state) => ({
        rightDeck: {
          ...state.rightDeck,
          radio,
          soundId,
        },
      }));

      // Apply stored filter and effects
      const freshState = get();
      applyStoredEffectsAndFilters(
        soundId,
        freshState.rightDeck.effects,
        freshState.rightDeck.filter
      );

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

      // If the previous radio was playing, auto-play the new one
      if (wasPlaying) {
        await getAudioManager().playSound(soundId, rightDeck.volume);
        applyCrossfade(get);
      }
    } catch (err) {
      // Error handling - AudioManager will also update state through subscription
      const msg =
        err instanceof Error ? err.message : "Failed to load right deck";
      set((_state) => ({
        error: msg,
      }));
    }
  },

  resetLeft: async () => {
    const { leftDeck, setLeftRadio } = get();
    if (leftDeck.radio) {
      await setLeftRadio(leftDeck.radio);
    }
  },

  resetRight: async () => {
    const { rightDeck, setRightRadio } = get();
    if (rightDeck.radio) {
      await setRightRadio(rightDeck.radio);
    }
  },
});
