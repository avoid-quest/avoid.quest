import {
  loadTrack,
  pauseDeckA,
  pauseDeckB,
  playDeckA,
  playDeckB,
  resetDeckA,
  resetDeckB,
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
import { useDeckA, useDeckB } from "@/lib/hooks/use-dj-state";
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
};

export function useDeckState(deckId: DeckId) {
  const isLeft = deckId === "deck-a";
  const deckA = useDeckA();
  const deckB = useDeckB();
  const deckState = isLeft ? deckA : deckB;
  const actions = isLeft ? deckAActions : deckBActions;

  return {
    // State
    radio: deckState?.radio ?? null,
    isPlaying: deckState?.isPlaying ?? false,
    isLoading: deckState?.isLoading ?? false,
    isBuffering: deckState?.isBuffering ?? false,
    volume: deckState?.volume ?? 1,
    muted: deckState?.muted ?? false,
    effects: deckState?.effects ?? [],
    filter: deckState?.filter ?? DEFAULT_FILTER,
    soundId: deckState?.soundId ?? null,
    // Channel strip state
    pan: deckState?.pan ?? 0,
    speed: deckState?.speed ?? 1,
    channelFilter: deckState?.channelFilter ?? 0,
    effectsDryWet: deckState?.effectsDryWet ?? 1,

    // Actions
    ...actions,
    loadTrack,
  };
}
