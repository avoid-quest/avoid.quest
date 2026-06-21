import { useMemo } from "react";
import {
  type DjDeckActions,
  getDjDeckActions,
  loadTrack,
} from "@/lib/dj-actions";
import { type DeckState, useDeckA, useDeckB } from "@/lib/hooks/use-dj-state";

const DEFAULT_FILTER = {
  type: "lowpass" as const,
  frequency: 1000,
  Q: 1,
  gain: 0,
  enabled: false,
};

const deckAActions = getDjDeckActions("deck-a");
const deckBActions = getDjDeckActions("deck-b");

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
  repeat: boolean;
  autoplay: boolean;
  play: DjDeckActions["play"];
  pause: DjDeckActions["pause"];
  setVolume: DjDeckActions["setVolume"];
  setMute: DjDeckActions["setMute"];
  reset: DjDeckActions["reset"];
  setPan: DjDeckActions["setPan"];
  setSpeed: DjDeckActions["setSpeed"];
  setChannelFilter: DjDeckActions["setChannelFilter"];
  setEffectsDryWet: DjDeckActions["setEffectsDryWet"];
  seek: DjDeckActions["seek"];
  setRepeat: DjDeckActions["setRepeat"];
  setAutoplay: DjDeckActions["setAutoplay"];
  loadSource: DjDeckActions["loadSource"];
  loadTrack: typeof loadTrack;
};

function createDeckStateResult(
  deckState: DeckState | null,
  actions: DjDeckActions
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
    repeat: deckState?.repeat ?? false,
    autoplay: deckState?.autoplay ?? true,
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
