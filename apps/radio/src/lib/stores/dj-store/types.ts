import type { FilterConfig } from "@/components/audio/filter-control";
import type { EffectConfig } from "@/lib/audio/effects/types";
import type { Platform } from "@/lib/external-url/types";
import type { Radio } from "@/lib/types";

// Types
export type DeckId = "left-deck" | "right-deck";
export type DeckSide = "left" | "right";

export type DeckState = {
  radio: Radio | null;
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  muted: boolean;
  effects: EffectConfig[];
  filter: FilterConfig;
  soundId: string | null;
};

export type MixerState = {
  crossfadePosition: number;
  masterVolume: number;
};

export type UiState = {
  activeDragRadio: Radio | null;
  pendingPlatformItem: {
    deckId: DeckId;
    platform: Platform;
  } | null;
};

export type DjState = {
  // State
  leftDeck: DeckState;
  rightDeck: DeckState;
  mixer: MixerState;
  ui: UiState;
  error: string | null;

  // Actions
  setLeftRadio: (radio: Radio | null) => Promise<void>;
  setRightRadio: (radio: Radio | null) => Promise<void>;

  playLeft: () => Promise<void>;
  pauseLeft: () => void;
  playRight: () => Promise<void>;
  pauseRight: () => void;

  setLeftVolume: (volume: number) => void;
  setRightVolume: (volume: number) => void;
  setMasterVolume: (volume: number) => void;
  setCrossfadePosition: (position: number) => void;

  setLeftMute: (muted: boolean) => void;
  setRightMute: (muted: boolean) => void;

  // Effects & Filters
  updateLeftFilter: (config: FilterConfig) => void;
  updateRightFilter: (config: FilterConfig) => void;

  addLeftEffect: (effectType: string) => void;
  addRightEffect: (effectType: string) => void;
  updateLeftEffect: (effectId: string, config: Partial<EffectConfig>) => void;
  updateRightEffect: (effectId: string, config: Partial<EffectConfig>) => void;
  removeLeftEffect: (effectId: string) => void;
  removeRightEffect: (effectId: string) => void;
  reorderLeftEffects: (effectIds: string[]) => void;
  reorderRightEffects: (effectIds: string[]) => void;

  // Track Management (Simplified API)
  loadTrack: (
    deckSide: DeckSide,
    radio: Radio | null,
    autoPlay?: boolean
  ) => Promise<void>;

  // UI Actions
  setActiveDragRadio: (radio: Radio | null) => void;
  setPendingPlatformItem: (
    item: { deckId: DeckId; platform: Platform } | null
  ) => void;
};

// Initial State
export const initialDeckState: DeckState = {
  radio: null,
  isPlaying: false,
  isLoading: false,
  volume: 1,
  muted: false,
  effects: [],
  filter: {
    type: "lowpass",
    frequency: 1000,
    Q: 1,
    gain: 0,
    enabled: false,
  },
  soundId: null,
};
