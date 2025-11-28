import type { StateCreator } from "zustand";
import type { Radio } from "@/lib/types";
import { getAudioManager, getSoundId } from "./audio-manager-helpers";
import { applyCrossfade } from "./mixer-actions";
import { findNextTrack } from "./track-actions";
import { type InternalDjState, initialDeckState } from "./types";

/**
 * Helper to apply stored effects and filters to a newly loaded sound
 */
function applyStoredEffectsAndFilters(
  soundId: string,
  effects: InternalDjState["leftDeck"]["effects"],
  filter: InternalDjState["leftDeck"]["filter"]
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
  InternalDjState,
  [],
  [],
  Pick<
    InternalDjState,
    "setLeftRadio" | "setRightRadio" | "resetLeft" | "resetRight" | "cleanupAll"
  >
> = (set, get) => ({
  cleanupAll: async () => {
    const { setLeftRadio, setRightRadio } = get();
    // Setting radio to null triggers cleanup logic in setRadio actions
    await Promise.all([setLeftRadio(null), setRightRadio(null)]);
  },

  setLeftRadio: async (radio: Radio | null) => {
    const { leftDeck, _subscriptionCleanup } = get();

    // Preserve the playing state before cleanup
    const wasPlaying = leftDeck.isPlaying;

    // Unsubscribe from previous subscription
    if (_subscriptionCleanup.left) {
      _subscriptionCleanup.left();
      set((state) => ({
        _subscriptionCleanup: { ...state._subscriptionCleanup, left: null },
      }));
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
      set(() => ({
        error: null,
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
      const cleanup = getAudioManager().subscribe(soundId, (audioState) => {
        const currentState = get();

        // Detect track end using explicit flag
        const trackEnded = audioState.hasEnded;

        // Compute next error message outside the set callback
        const nextError = audioState.error
          ? audioState.error.message
          : currentState.error;

        // Only update if state actually changed to prevent unnecessary re-renders
        if (
          currentState.leftDeck.isPlaying !== audioState.isPlaying ||
          currentState.leftDeck.isLoading !== audioState.isLoading ||
          currentState.error !== nextError
        ) {
          set((state) => ({
            leftDeck: {
              ...state.leftDeck,
              isPlaying: audioState.isPlaying,
              isLoading: audioState.isLoading,
            },
            error: nextError,
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
      });
      set((state) => ({
        _subscriptionCleanup: { ...state._subscriptionCleanup, left: cleanup },
      }));

      // If the previous radio was playing, auto-play the new one
      if (wasPlaying) {
        const stateForVolume = get();
        await getAudioManager().playSound(
          soundId,
          stateForVolume.leftDeck.volume
        );
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
    const { rightDeck, _subscriptionCleanup } = get();

    // Preserve the playing state before cleanup
    const wasPlaying = rightDeck.isPlaying;

    // Unsubscribe from previous subscription
    if (_subscriptionCleanup.right) {
      _subscriptionCleanup.right();
      set((state) => ({
        _subscriptionCleanup: { ...state._subscriptionCleanup, right: null },
      }));
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
      set(() => ({
        error: null,
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
      const cleanup = getAudioManager().subscribe(soundId, (audioState) => {
        const currentState = get();

        // Detect track end using explicit flag
        const trackEnded = audioState.hasEnded;

        // Compute next error message outside the set callback
        const nextError = audioState.error
          ? audioState.error.message
          : currentState.error;

        // Only update if state actually changed to prevent unnecessary re-renders
        if (
          currentState.rightDeck.isPlaying !== audioState.isPlaying ||
          currentState.rightDeck.isLoading !== audioState.isLoading ||
          currentState.error !== nextError
        ) {
          set((state) => ({
            rightDeck: {
              ...state.rightDeck,
              isPlaying: audioState.isPlaying,
              isLoading: audioState.isLoading,
            },
            error: nextError,
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
      });
      set((state) => ({
        _subscriptionCleanup: { ...state._subscriptionCleanup, right: cleanup },
      }));

      // If the previous radio was playing, auto-play the new one
      if (wasPlaying) {
        const stateForVolume = get();
        await getAudioManager().playSound(
          soundId,
          stateForVolume.rightDeck.volume
        );
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
