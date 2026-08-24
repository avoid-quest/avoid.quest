import { useMemo } from "react";
import {
  type DjDeckHandle,
  type DjDeckLoadIntent,
  type DjDeckLoadResult,
  getDjDeckModule,
} from "@/lib/dj-deck";
import { type DeckState, useDeckA, useDeckB } from "@/lib/hooks/use-dj-state";

const DEFAULT_FILTER = {
  type: "lowpass" as const,
  frequency: 1000,
  Q: 1,
  gain: 0,
  enabled: false,
};

type DeckStateActions = {
  loadSource: (intent: DjDeckLoadIntent) => Promise<DjDeckLoadResult>;
  pause: () => void;
  play: () => Promise<void>;
  reset: () => Promise<void>;
  seek: (position: number) => void;
  setAutoplay: (enabled: boolean) => void;
  setChannelFilter: (value: number) => void;
  setEffectsDryWet: (value: number) => void;
  setMute: (muted: boolean) => void;
  setPan: (pan: number) => void;
  setRepeat: (enabled: boolean) => void;
  setSpeed: (speed: number) => void;
  setVolume: (volume: number) => void;
};

function createDeckActions(deck: DjDeckHandle): DeckStateActions {
  return {
    loadSource: deck.load,
    pause: () => deck.transport({ type: "pause" }),
    play: () => deck.transport({ type: "play" }),
    reset: () => deck.transport({ type: "reset" }),
    seek: (position) => deck.transport({ type: "seek", position }),
    setAutoplay: (enabled) => deck.change({ type: "autoplay", enabled }),
    setChannelFilter: (value) => deck.change({ type: "channel-filter", value }),
    setEffectsDryWet: (value) =>
      deck.change({ type: "effects-dry-wet", value }),
    setMute: (muted) => deck.change({ type: "mute", muted }),
    setPan: (pan) => deck.change({ type: "pan", pan }),
    setRepeat: (enabled) => deck.change({ type: "repeat", enabled }),
    setSpeed: (speed) => deck.change({ type: "speed", speed }),
    setVolume: (volume) => deck.change({ type: "volume", volume }),
  };
}

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
  play: DeckStateActions["play"];
  pause: DeckStateActions["pause"];
  setVolume: DeckStateActions["setVolume"];
  setMute: DeckStateActions["setMute"];
  reset: DeckStateActions["reset"];
  setPan: DeckStateActions["setPan"];
  setSpeed: DeckStateActions["setSpeed"];
  setChannelFilter: DeckStateActions["setChannelFilter"];
  setEffectsDryWet: DeckStateActions["setEffectsDryWet"];
  seek: DeckStateActions["seek"];
  setRepeat: DeckStateActions["setRepeat"];
  setAutoplay: DeckStateActions["setAutoplay"];
  loadSource: DeckStateActions["loadSource"];
};

function createDeckStateResult(
  deckState: DeckState | null,
  actions: DeckStateActions
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
  };
}

/**
 * Hook for Deck A state only - subscribes only to Deck A
 */
export function useDeckAState(): DeckStateResult {
  const deckState = useDeckA();
  const deck = getDjDeckModule().deck("deck-a");
  const actions = useMemo(() => createDeckActions(deck), [deck]);
  return useMemo(
    () => createDeckStateResult(deckState, actions),
    [deckState, actions]
  );
}

/**
 * Hook for Deck B state only - subscribes only to Deck B
 */
export function useDeckBState(): DeckStateResult {
  const deckState = useDeckB();
  const deck = getDjDeckModule().deck("deck-b");
  const actions = useMemo(() => createDeckActions(deck), [deck]);
  return useMemo(
    () => createDeckStateResult(deckState, actions),
    [deckState, actions]
  );
}
