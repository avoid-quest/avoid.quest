import type { StateCreator } from "zustand";
import type { Radio } from "@/lib/audio";
import { getAudioManager, getSoundId } from "./audio-manager-helpers";
import { applyCrossfade } from "./mixer-actions";
import { findNextTrack } from "./track-actions";
import { type InternalDjState, initialDeckState } from "./types";

/**
 * Helper to apply stored effects and filters to a newly loaded sound
 */
function applyStoredEffectsAndFilters(
  soundId: string,
  effects: InternalDjState["deckA"]["effects"],
  filter: InternalDjState["deckA"]["filter"]
) {
  try {
    // Apply stored filter if enabled
    if (filter.enabled) {
      getAudioManager().updateFilter(soundId, filter);
    }

    // Apply stored effects
    for (const effect of effects) {
      const success = getAudioManager().addEffect(soundId, effect);
      if (!success) {
        console.warn(
          `[DeckLoading] Failed to apply effect ${effect.type} to ${soundId}`
        );
      }
    }
  } catch (err) {
    console.error("[DeckLoading] Error applying stored effects:", err);
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
    const { deckA, _subscriptionCleanup } = get();

    // Preserve the playing state before cleanup
    const wasPlaying = deckA.isPlaying;

    // Unsubscribe from previous subscription
    if (_subscriptionCleanup.left) {
      _subscriptionCleanup.left();
      set((state) => ({
        _subscriptionCleanup: { ...state._subscriptionCleanup, left: null },
      }));
    }

    // Cleanup existing sound
    if (deckA.soundId) {
      await getAudioManager().cleanupSound(deckA.soundId);
    }

    if (!radio) {
      set((_state) => ({
        deckA: { ...initialDeckState },
      }));
      return;
    }

    const soundId = getSoundId(radio, "left");

    try {
      set(() => ({
        error: null,
      }));

      // Loading state will be managed by AudioManager through subscription
      getAudioManager().createSound(radio, soundId);

      set((state) => ({
        deckA: {
          ...state.deckA,
          radio,
          soundId,
        },
      }));

      // Apply stored filter and effects
      const freshState = get();
      applyStoredEffectsAndFilters(
        soundId,
        freshState.deckA.effects,
        freshState.deckA.filter
      );

      // Subscribe to this sound's events and store cleanup function
      const cleanup = getAudioManager().subscribe(soundId, (audioState) => {
        const currentState = get();

        // Detect track end using explicit flag
        const trackEnded = audioState.hasEnded;

        // Compute next error message outside the set callback
        const nextError = audioState.error?.message ?? null;

        // Only update if state actually changed to prevent unnecessary re-renders
        if (
          currentState.deckA.isPlaying !== audioState.isPlaying ||
          currentState.deckA.isLoading !== audioState.isLoading ||
          currentState.deckA.isBuffering !== audioState.isBuffering ||
          currentState.error !== nextError
        ) {
          set((state) => ({
            deckA: {
              ...state.deckA,
              isPlaying: audioState.isPlaying,
              isLoading: audioState.isLoading,
              isBuffering: audioState.isBuffering,
            },
            error: nextError,
          }));
        }

        // Handle track end - auto-advance to next track
        if (trackEnded) {
          const nextTrack = findNextTrack(currentState.deckA.radio);
          if (nextTrack && currentState.deckA.radio) {
            // Load next track asynchronously
            get().loadTrack(
              "left",
              {
                ...currentState.deckA.radio,
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
        await getAudioManager().playSound(soundId, stateForVolume.deckA.volume);
        applyCrossfade(get);
      }
    } catch (err) {
      // Error handling - AudioManager will also update state through subscription
      const msg =
        err instanceof Error ? err.message : "Failed to load Deck A";
      set((_state) => ({
        error: msg,
      }));
    }
  },

  setRightRadio: async (radio: Radio | null) => {
    const { deckB, _subscriptionCleanup } = get();

    // Preserve the playing state before cleanup
    const wasPlaying = deckB.isPlaying;

    // Unsubscribe from previous subscription
    if (_subscriptionCleanup.right) {
      _subscriptionCleanup.right();
      set((state) => ({
        _subscriptionCleanup: { ...state._subscriptionCleanup, right: null },
      }));
    }

    // Cleanup existing sound
    if (deckB.soundId) {
      await getAudioManager().cleanupSound(deckB.soundId);
    }

    if (!radio) {
      set((_state) => ({
        deckB: { ...initialDeckState },
      }));
      return;
    }

    const soundId = getSoundId(radio, "right");

    try {
      set(() => ({
        error: null,
      }));

      // Loading state will be managed by AudioManager through subscription
      getAudioManager().createSound(radio, soundId);

      set((state) => ({
        deckB: {
          ...state.deckB,
          radio,
          soundId,
        },
      }));

      // Apply stored filter and effects
      const freshState = get();
      applyStoredEffectsAndFilters(
        soundId,
        freshState.deckB.effects,
        freshState.deckB.filter
      );

      // Subscribe to this sound's events and store cleanup function
      const cleanup = getAudioManager().subscribe(soundId, (audioState) => {
        const currentState = get();

        // Detect track end using explicit flag
        const trackEnded = audioState.hasEnded;

        // Compute next error message outside the set callback
        const nextError = audioState.error?.message ?? null;

        // Only update if state actually changed to prevent unnecessary re-renders
        if (
          currentState.deckB.isPlaying !== audioState.isPlaying ||
          currentState.deckB.isLoading !== audioState.isLoading ||
          currentState.deckB.isBuffering !== audioState.isBuffering ||
          currentState.error !== nextError
        ) {
          set((state) => ({
            deckB: {
              ...state.deckB,
              isPlaying: audioState.isPlaying,
              isLoading: audioState.isLoading,
              isBuffering: audioState.isBuffering,
            },
            error: nextError,
          }));
        }

        // Handle track end - auto-advance to next track
        if (trackEnded) {
          const nextTrack = findNextTrack(currentState.deckB.radio);
          if (nextTrack && currentState.deckB.radio) {
            // Load next track asynchronously
            get().loadTrack(
              "right",
              {
                ...currentState.deckB.radio,
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
        await getAudioManager().playSound(soundId, stateForVolume.deckB.volume);
        applyCrossfade(get);
      }
    } catch (err) {
      // Error handling - AudioManager will also update state through subscription
      const msg =
        err instanceof Error ? err.message : "Failed to load Deck B";
      set((_state) => ({
        error: msg,
      }));
    }
  },

  resetLeft: async () => {
    const { deckA, setLeftRadio } = get();
    if (deckA.radio) {
      await setLeftRadio(deckA.radio);
    }
  },

  resetRight: async () => {
    const { deckB, setRightRadio } = get();
    if (deckB.radio) {
      await setRightRadio(deckB.radio);
    }
  },
});
