import type {
  EffectConfig,
  EffectType,
  FilterConfig,
  Radio,
} from "@/lib/audio";
import type { Platform } from "@/lib/platform-types";

// Types
export type DeckId = "deck-a" | "deck-b";
export type DeckSide = "left" | "right";

export type DeckState = {
  radio: Radio | null;
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
  volume: number;
  muted: boolean;
  effects: EffectConfig[];
  filter: FilterConfig;
  soundId: string | null;
  // Channel strip params
  pan: number; // -1 (left) to 1 (right)
  speed: number; // 0.5x to 2.0x (playbackRate)
  channelFilter: number; // -1 (LP) to 0 (off) to 1 (HP)
  effectsDryWet: number; // 0 (bypass all) to 1 (full effects)
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

// Public API type (without internal state)
export type DjState = {
  // State
  deckA: DeckState;
  deckB: DeckState;
  mixer: MixerState;
  ui: UiState;
  error: string | null;

  // Actions
  setLeftRadio: (radio: Radio | null) => Promise<void>;
  setRightRadio: (radio: Radio | null) => Promise<void>;

  playLeft: () => Promise<void>;
  pauseLeft: () => void;
  resetLeft: () => Promise<void>;
  playRight: () => Promise<void>;
  pauseRight: () => void;
  resetRight: () => Promise<void>;
  cleanupAll: () => Promise<void>;
  cleanupAudioOnly: () => Promise<void>;

  setLeftVolume: (volume: number) => void;
  setRightVolume: (volume: number) => void;
  setMasterVolume: (volume: number) => void;
  setCrossfadePosition: (position: number) => void;

  setLeftMute: (muted: boolean) => void;
  setRightMute: (muted: boolean) => void;

  // Channel Strip
  setLeftPan: (pan: number) => void;
  setRightPan: (pan: number) => void;
  setLeftSpeed: (speed: number) => void;
  setRightSpeed: (speed: number) => void;
  setLeftChannelFilter: (value: number) => void;
  setRightChannelFilter: (value: number) => void;
  setLeftEffectsDryWet: (value: number) => void;
  setRightEffectsDryWet: (value: number) => void;

  // Effects & Filters
  updateLeftFilter: (config: FilterConfig) => void;
  updateRightFilter: (config: FilterConfig) => void;

  addLeftEffect: (effectType: EffectType) => void;
  addRightEffect: (effectType: EffectType) => void;
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

// Internal state type (includes subscription cleanup)
export type InternalDjState = DjState & {
  // Internal: subscription cleanup functions
  _subscriptionCleanup: {
    left: (() => void) | null;
    right: (() => void) | null;
  };
};

// Initial State
export const initialDeckState: DeckState = {
  radio: null,
  isPlaying: false,
  isLoading: false,
  isBuffering: false,
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
  // Channel strip defaults
  pan: 0, // Center
  speed: 1.0, // Normal speed
  channelFilter: 0, // Filter off
  effectsDryWet: 1.0, // Full effects
};
