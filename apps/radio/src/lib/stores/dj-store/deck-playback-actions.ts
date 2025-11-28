import type { StateCreator } from "zustand";
import { getAudioManager } from "./audio-manager-helpers";
import { applyCrossfade } from "./mixer-actions";
import type { InternalDjState } from "./types";

export const createDeckPlaybackActions: StateCreator<
  InternalDjState,
  [],
  [],
  Pick<InternalDjState, "playLeft" | "playRight" | "pauseLeft" | "pauseRight">
> = (set, get) => ({
  playLeft: async () => {
    const { leftDeck, setLeftRadio } = get();
    if (leftDeck.radio && !leftDeck.isPlaying) {
      // Loading state will be managed by AudioManager through subscription

      // Always reset buffer before playing to ensure fresh audio
      // This is crucial for live radio stations to avoid stale buffers
      await setLeftRadio(leftDeck.radio);

      // Get fresh state after reload
      const { leftDeck: newLeftDeck } = get();
      if (newLeftDeck.soundId) {
        try {
          await getAudioManager().playSound(
            newLeftDeck.soundId,
            newLeftDeck.volume
          );
          applyCrossfade(get);
        } catch (err) {
          // Error handling - AudioManager will also update state through subscription
          set({
            error: err instanceof Error ? err.message : "Failed to play left",
          });
        }
      }
    }
  },

  playRight: async () => {
    const { rightDeck, setRightRadio } = get();
    if (rightDeck.radio && !rightDeck.isPlaying) {
      // Loading state will be managed by AudioManager through subscription

      // Always reset buffer before playing to ensure fresh audio
      await setRightRadio(rightDeck.radio);

      // Get fresh state after reload
      const { rightDeck: newRightDeck } = get();
      if (newRightDeck.soundId) {
        try {
          await getAudioManager().playSound(
            newRightDeck.soundId,
            newRightDeck.volume
          );
          applyCrossfade(get);
        } catch (err) {
          // Error handling - AudioManager will also update state through subscription
          set({
            error: err instanceof Error ? err.message : "Failed to play right",
          });
        }
      }
    }
  },

  pauseLeft: () => {
    const { leftDeck } = get();
    if (leftDeck.soundId) {
      getAudioManager().pauseSound(leftDeck.soundId);
    }
  },

  pauseRight: () => {
    const { rightDeck } = get();
    if (rightDeck.soundId) {
      getAudioManager().pauseSound(rightDeck.soundId);
    }
  },
});
