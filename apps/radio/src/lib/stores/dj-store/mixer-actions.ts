import type { StateCreator } from "zustand";
import { getAudioManager } from "./audio-manager-helpers";
import type { DjState } from "./types";

export const createMixerActions: StateCreator<
  DjState,
  [],
  [],
  Pick<DjState, "setMasterVolume" | "setCrossfadePosition">
> = (set, get) => {
  // Helper to apply crossfade
  const applyCrossfade = () => {
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

  return {
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
      applyCrossfade();
    },
  };
};

// Export applyCrossfade for use by deck actions
export const applyCrossfade = (get: () => DjState) => {
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
