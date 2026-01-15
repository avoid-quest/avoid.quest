import type { Radio } from "@avoid.quest/cacophony";
import { AudioManager } from "@avoid.quest/cacophony";
import type { DeckSide } from "./types";

// Lazy initialization of AudioManager to avoid SSR issues
let audioManager: AudioManager | null = null;

export const getAudioManager = (): AudioManager => {
  if (typeof window === "undefined") {
    throw new Error("AudioManager can only be used in browser environment");
  }
  if (!audioManager) {
    audioManager = AudioManager.getInstance();
  }
  return audioManager;
};

export const getSoundId = (radio: Radio, side: DeckSide): string =>
  `${side}_${radio.id}`;
