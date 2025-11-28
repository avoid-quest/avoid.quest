import type { StateCreator } from "zustand";
import { getAudioManager } from "./audio-manager-helpers";
import type { InternalDjState } from "./types";

// Export applyCrossfade for use by deck actions
export const applyCrossfade = (get: () => InternalDjState) => {
  if (typeof window === "undefined") {
    return;
  }

  const { leftDeck, rightDeck, mixer } = get();
  const { crossfadePosition } = mixer;

  const leftFinalVol = (1 - crossfadePosition) * leftDeck.volume;
  const rightFinalVol = crossfadePosition * rightDeck.volume;

  const manager = getAudioManager();
  if (leftDeck.soundId) {
    manager.setVolume(leftDeck.soundId, leftFinalVol);
  }
  if (rightDeck.soundId) {
    manager.setVolume(rightDeck.soundId, rightFinalVol);
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
