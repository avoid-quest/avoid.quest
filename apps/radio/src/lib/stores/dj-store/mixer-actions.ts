import type { StateCreator } from "zustand";
import { getAudioManager } from "./audio-manager-helpers";
import type { InternalDjState } from "./types";

// Export applyCrossfade for use by deck actions
export const applyCrossfade = (get: () => InternalDjState) => {
  if (typeof window === "undefined") {
    return;
  }

  const { deckA, deckB, mixer } = get();
  const { crossfadePosition } = mixer;

  const leftFinalVol = (1 - crossfadePosition) * deckA.volume;
  const rightFinalVol = crossfadePosition * deckB.volume;

  const manager = getAudioManager();
  if (deckA.soundId) {
    manager.setVolume(deckA.soundId, leftFinalVol);
  }
  if (deckB.soundId) {
    manager.setVolume(deckB.soundId, rightFinalVol);
  }
};

export const createMixerActions: StateCreator<
  InternalDjState,
  [],
  [],
  Pick<InternalDjState, "setMasterVolume" | "setCrossfadePosition">
> = (set, get) => ({
  setMasterVolume: (volume) => {
    set((state) => ({
      mixer: { ...state.mixer, masterVolume: volume },
    }));
    getAudioManager().setGlobalVolume(volume);
  },

  setCrossfadePosition: (position) => {
    set((state) => ({
      mixer: { ...state.mixer, crossfadePosition: position },
    }));
    applyCrossfade(get);
  },
});
