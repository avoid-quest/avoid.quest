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
    const { deckA } = get();
    if (deckA.soundId && deckA.radio && !deckA.isPlaying) {
      try {
        await getAudioManager().playSound(deckA.soundId, deckA.volume);
        applyCrossfade(get);
      } catch (err) {
        set({
          error: err instanceof Error ? err.message : "Failed to play Deck A",
        });
      }
    }
  },

  playRight: async () => {
    const { deckB } = get();
    if (deckB.soundId && deckB.radio && !deckB.isPlaying) {
      try {
        await getAudioManager().playSound(deckB.soundId, deckB.volume);
        applyCrossfade(get);
      } catch (err) {
        set({
          error: err instanceof Error ? err.message : "Failed to play Deck B",
        });
      }
    }
  },

  pauseLeft: () => {
    const { deckA } = get();
    if (deckA.soundId) {
      getAudioManager().pauseSound(deckA.soundId);
    }
  },

  pauseRight: () => {
    const { deckB } = get();
    if (deckB.soundId) {
      getAudioManager().pauseSound(deckB.soundId);
    }
  },
});
