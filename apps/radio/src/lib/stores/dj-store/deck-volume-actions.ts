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
