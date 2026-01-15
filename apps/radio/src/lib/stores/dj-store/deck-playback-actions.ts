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
    const { leftDeck } = get();
    if (leftDeck.soundId && leftDeck.radio && !leftDeck.isPlaying) {
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

  playRight: async () => {
    const { rightDeck } = get();
    if (rightDeck.soundId && rightDeck.radio && !rightDeck.isPlaying) {
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
