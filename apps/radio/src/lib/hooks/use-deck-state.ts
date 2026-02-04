import { useMemo } from "react";
import {
  loadTrack,
  pauseDeckA,
  pauseDeckB,
  playDeckA,
  playDeckB,
  resetDeckA,
  resetDeckB,
  seekDeckA,
  seekDeckB,
  setDeckAChannelFilter,
  setDeckAEffectsDryWet,
  setDeckAMute,
  setDeckAPan,
  setDeckASpeed,
  setDeckAVolume,
  setDeckBChannelFilter,
  setDeckBEffectsDryWet,
  setDeckBMute,
  setDeckBPan,
  setDeckBSpeed,
  setDeckBVolume,
} from "@/lib/dj-actions";
import { type DeckState, useDeckA, useDeckB } from "@/lib/hooks/use-dj-state";
import type { DeckId } from "@/lib/stores/dj-runtime-store";

const DEFAULT_FILTER = {
  type: "lowpass" as const,
  frequency: 1000,
  Q: 1,
  gain: 0,
  enabled: false,
};

const deckAActions = {
  play: playDeckA,
  pause: pauseDeckA,
  setVolume: setDeckAVolume,
  setMute: setDeckAMute,
  reset: resetDeckA,
  setPan: setDeckAPan,
  setSpeed: setDeckASpeed,
  setChannelFilter: setDeckAChannelFilter,
  setEffectsDryWet: setDeckAEffectsDryWet,
  seek: seekDeckA,
};

const deckBActions = {
  play: playDeckB,
  pause: pauseDeckB,
  setVolume: setDeckBVolume,
  setMute: setDeckBMute,
  reset: resetDeckB,
  setPan: setDeckBPan,
  setSpeed: setDeckBSpeed,
  setChannelFilter: setDeckBChannelFilter,
  setEffectsDryWet: setDeckBEffectsDryWet,
  seek: seekDeckB,
};

type DeckStateResult = {
  radio: DeckState["radio"];
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
  volume: number;
  muted: boolean;
  effects: DeckState["effects"];
  filter: DeckState["filter"];
  soundId: string | null;
  pan: number;
  speed: number;
  channelFilter: number;
  effectsDryWet: number;
  play: typeof playDeckA;
  pause: typeof pauseDeckA;
  setVolume: typeof setDeckAVolume;
  setMute: typeof setDeckAMute;
  reset: typeof resetDeckA;
  setPan: typeof setDeckAPan;
  setSpeed: typeof setDeckASpeed;
  setChannelFilter: typeof setDeckAChannelFilter;
  setEffectsDryWet: typeof setDeckAEffectsDryWet;
  seek: typeof seekDeckA;
  loadTrack: typeof loadTrack;
};

function createDeckStateResult(
  deckState: DeckState | null,
  actions: typeof deckAActions
): DeckStateResult {
  return {
    radio: deckState?.radio ?? null,
    isPlaying: deckState?.isPlaying ?? false,
    isLoading: deckState?.isLoading ?? false,
    isBuffering: deckState?.isBuffering ?? false,
    volume: deckState?.volume ?? 1,
    muted: deckState?.muted ?? false,
    effects: deckState?.effects ?? [],
    filter: deckState?.filter ?? DEFAULT_FILTER,
    soundId: deckState?.soundId ?? null,
    pan: deckState?.pan ?? 0,
    speed: deckState?.speed ?? 1,
    channelFilter: deckState?.channelFilter ?? 0,
    effectsDryWet: deckState?.effectsDryWet ?? 1,
    ...actions,
    loadTrack,
  };
}

/**
 * Hook for Deck A state only - subscribes only to Deck A
 */
export function useDeckAState(): DeckStateResult {
  const deckState = useDeckA();
  return useMemo(
    () => createDeckStateResult(deckState, deckAActions),
    [deckState]
  );
}

/**
 * Hook for Deck B state only - subscribes only to Deck B
 */
export function useDeckBState(): DeckStateResult {
  const deckState = useDeckB();
  return useMemo(
    () => createDeckStateResult(deckState, deckBActions),
    [deckState]
  );
}

/**
 * Hook for deck state by ID - prefer useDeckAState/useDeckBState for better performance
 * @deprecated Use useDeckAState() or useDeckBState() directly to avoid subscribing to both decks
 */
export function useDeckState(deckId: DeckId): DeckStateResult {
  const deckAState = useDeckAState();
  const deckBState = useDeckBState();
  return deckId === "deck-a" ? deckAState : deckBState;
}
