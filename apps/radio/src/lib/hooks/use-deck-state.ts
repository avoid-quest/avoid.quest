import { useMemo, useSyncExternalStore } from "react";
import {
  type DeckId,
  type DjDeckHandle,
  type DjDeckLoadIntent,
  type DjDeckLoadResult,
  type DjDeckModule,
  getDjDeckModule,
} from "@/lib/dj-deck";
import { type DeckState, useDeckA, useDeckB } from "@/lib/hooks/use-dj-state";
import type { Platform } from "@/lib/platform-types";

const DEFAULT_FILTER = {
  enabled: false,
  frequency: 1000,
  gain: 0,
  Q: 1,
  type: "lowpass" as const,
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
  deckId: DeckId,
  deck: DjDeckHandle,
  pendingSource: DjDeckModule["pendingSource"]
): DeckStateActions {
  return {
    cancelPendingSource: () => pendingSource.cancel(deckId),
    loadSource: deck.load,
    pause: () => deck.transport({ type: "pause" }),
    play: () => deck.transport({ type: "play" }),
    reset: () => deck.transport({ type: "reset" }),
    seek: (position) => deck.transport({ position, type: "seek" }),
    setAutoplay: (enabled) => deck.change({ enabled, type: "autoplay" }),
    setChannelFilter: (value) => deck.change({ type: "channel-filter", value }),
    setEffectsDryWet: (value) =>
      deck.change({ type: "effects-dry-wet", value }),
    setMute: (muted) => deck.change({ muted, type: "mute" }),
    setPan: (pan) => deck.change({ pan, type: "pan" }),
    setRepeat: (enabled) => deck.change({ enabled, type: "repeat" }),
    setSpeed: (speed) => deck.change({ speed, type: "speed" }),
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
    autoplay: deckState?.autoplay ?? true,
    channelFilter: deckState?.channelFilter ?? 0,
    effects: deckState?.effects ?? [],
    effectsDryWet: deckState?.effectsDryWet ?? 1,
    filter: deckState?.filter ?? DEFAULT_FILTER,
    isBuffering: deckState?.isBuffering ?? false,
    isLoading: deckState?.isLoading ?? false,
    isPlaying: deckState?.isPlaying ?? false,
    muted: deckState?.muted ?? false,
    pan: deckState?.pan ?? 0,
    pendingPlatform,
    radio: deckState?.radio ?? null,
    repeat: deckState?.repeat ?? false,
    soundId: deckState?.soundId ?? null,
    speed: deckState?.speed ?? 1,
    volume: deckState?.volume ?? 1,
    ...actions,
  };
}

function usePendingPlatform(
  module: DjDeckModule,
  deckId: DeckId
): Platform | undefined {
  const pendingSources = useSyncExternalStore(
    module.pendingSource.subscribe,
    module.pendingSource.getSnapshot,
    module.pendingSource.getSnapshot
  );
  return pendingSources[deckId] ?? undefined;
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
    () => createDeckActions("deck-a", deck, module.pendingSource),
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
    () => createDeckActions("deck-b", deck, module.pendingSource),
    [deck, module.pendingSource]
  );
  return useMemo(
    () => createDeckStateResult(deckState, actions, pendingPlatform),
    [deckState, actions, pendingPlatform]
  );
}
