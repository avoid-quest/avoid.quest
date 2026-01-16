import type { StateCreator } from "zustand";
import { getAudioManager } from "./audio-manager-helpers";
import { applyCrossfade } from "./mixer-actions";
import type { InternalDjState } from "./types";

export const createDeckVolumeActions: StateCreator<
  InternalDjState,
  [],
  [],
  Pick<
    InternalDjState,
    "setLeftVolume" | "setRightVolume" | "setLeftMute" | "setRightMute"
  >
> = (set, get) => ({
  setLeftVolume: (volume: number) => {
    set((state) => ({
      deckA: { ...state.deckA, volume },
    }));
    applyCrossfade(get);
  },

  setRightVolume: (volume: number) => {
    set((state) => ({
      deckB: { ...state.deckB, volume },
    }));
    applyCrossfade(get);
  },

  setLeftMute: (muted: boolean) => {
    const { deckA } = get();
    set((state) => ({
      deckA: { ...state.deckA, muted },
    }));
    if (deckA.soundId) {
      if (muted) {
        getAudioManager().muteSound(deckA.soundId);
      } else {
        getAudioManager().unmuteSound(deckA.soundId);
      }
    }
  },

  setRightMute: (muted: boolean) => {
    const { deckB } = get();
    set((state) => ({
      deckB: { ...state.deckB, muted },
    }));
    if (deckB.soundId) {
      if (muted) {
        getAudioManager().muteSound(deckB.soundId);
      } else {
        getAudioManager().unmuteSound(deckB.soundId);
      }
    }
  },
});
