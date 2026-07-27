import { createContext, useContext } from "react";
import type { EffectConfig, EffectType, Radio } from "@/lib/audio";
import type { PlatformMetadata, PlatformTrack } from "@/lib/platform-types";

type DeckContextValue = {
  deckId: "deck-a" | "deck-b";
  deckSide: "left" | "right";
  // Deck state
  radio: Radio | null;
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
  volume: number;
  pan: number;
  speed: number;
  channelFilter: number;
  effectsDryWet: number;
  effects: EffectConfig[];
  effectsTempo: number;
  repeat: boolean;
  autoplay: boolean;
  soundId: string | null;
  // Actions
  play: () => Promise<void>;
  pause: () => void;
  setVolume: (v: number) => void;
  setPan: (v: number) => void;
  setSpeed: (v: number) => void;
  setChannelFilter: (v: number) => void;
  setEffectsDryWet: (v: number) => void;
  setRepeat: (enabled: boolean) => void;
  setAutoplay: (enabled: boolean) => void;
  seek: (position: number) => void;
  loadTrack: (streamUrl: string) => Promise<void>;
  reset: () => Promise<void>;
  // Effect actions
  addEffect: (type: EffectType) => void;
  updateEffect: (id: string, config: Partial<EffectConfig>) => void;
  removeEffect: (id: string) => void;
  reorderEffects: (ids: string[]) => void;
  setEffectsTempo: (tempo: number) => void;
  // Derived data
  trackProgress: { position: number; duration: number } | undefined;
  peakLevel: { left: number; right: number };
  metadata: PlatformMetadata | undefined;
  currentTrackIndex: number;
  // Streaming helpers
  hasTracklist: boolean;
  tracks: PlatformTrack[] | undefined;
  isFileSource: boolean;
  isSeekable: boolean;
};

const DeckContext = createContext<DeckContextValue | null>(null);

export function useDeckContext(): DeckContextValue {
  const ctx = useContext(DeckContext);
  if (!ctx) {
    throw new Error("useDeckContext must be used within a DeckProvider");
  }
  return ctx;
}

export const DeckProvider = DeckContext.Provider;
export type { DeckContextValue };
