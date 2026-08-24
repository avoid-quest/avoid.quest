import { useMemo, useSyncExternalStore } from "react";
import {
  type DjDeckHandle,
  type DjDeckLoadIntent,
  type DjDeckLoadResult,
  type DjDeckModule,
  getDjDeckModule,
} from "@/lib/dj-deck";
import { type DeckState, useDeckA, useDeckB } from "@/lib/hooks/use-dj-state";
import type { Platform } from "@/lib/platform-types";

const DEFAULT_FILTER = {
  type: "lowpass" as const,
  frequency: 1000,
  Q: 1,
  gain: 0,
  enabled: false,
};

type DeckStateActions = {
  cancelPendingSource: () => void;
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

function createDeckActions(
  deck: DjDeckHandle,
  pendingSource: DjDeckModule["pendingSource"]
): DeckStateActions {
  return {
    cancelPendingSource: pendingSource.cancel,
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
  pendingPlatform: Platform | undefined;
  cancelPendingSource: DeckStateActions["cancelPendingSource"];
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
  actions: DeckStateActions,
  pendingPlatform: Platform | undefined
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
    pendingPlatform,
    ...actions,
  };
}

function usePendingPlatform(
  module: DjDeckModule,
  deckId: "deck-a" | "deck-b"
): Platform | undefined {
  const pendingSource = useSyncExternalStore(
    module.pendingSource.subscribe,
    module.pendingSource.getSnapshot,
    module.pendingSource.getSnapshot
  );
  return pendingSource?.deckId === deckId ? pendingSource.platform : undefined;
}

/**
 * Hook for Deck A state only - subscribes only to Deck A
 */
export function useDeckAState(): DeckStateResult {
  const deckState = useDeckA();
  const module = getDjDeckModule();
  const deck = module.deck("deck-a");
  const pendingPlatform = usePendingPlatform(module, "deck-a");
  const actions = useMemo(
    () => createDeckActions(deck, module.pendingSource),
    [deck, module.pendingSource]
  );
  return useMemo(
    () => createDeckStateResult(deckState, actions, pendingPlatform),
    [deckState, actions, pendingPlatform]
  );
}

/**
 * Hook for Deck B state only - subscribes only to Deck B
 */
export function useDeckBState(): DeckStateResult {
  const deckState = useDeckB();
  const module = getDjDeckModule();
  const deck = module.deck("deck-b");
  const pendingPlatform = usePendingPlatform(module, "deck-b");
  const actions = useMemo(
    () => createDeckActions(deck, module.pendingSource),
    [deck, module.pendingSource]
  );
  return useMemo(
    () => createDeckStateResult(deckState, actions, pendingPlatform),
    [deckState, actions, pendingPlatform]
  );
}
