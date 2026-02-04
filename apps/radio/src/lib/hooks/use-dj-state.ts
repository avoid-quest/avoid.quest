import { eq, useLiveQuery } from "@tanstack/react-db";
import type { EffectConfig, FilterConfig, Radio } from "@/lib/audio";
import {
  type DeckRecord,
  deckCollection,
  type MixerRecord,
  mixerCollection,
  resetAllDjState as resetAllDjStateDb,
  resetDeck as resetDeckDb,
} from "@/lib/collections";
import type { Platform } from "@/lib/platform-types";
import {
  type DeckId,
  getDeckARuntime,
  getDeckBRuntime,
  resetAllDjRuntime,
  resetDeckARuntime,
  resetDeckBRuntime,
  setActiveDragRadio as setActiveDragRadioStore,
  setPendingPlatformItem as setPendingPlatformItemStore,
  useDeckARuntimeState,
  useDeckBRuntimeState,
} from "@/lib/stores/dj-runtime-store";

const DECK_A_ID = "deck-a";
const DECK_B_ID = "deck-b";
const MIXER_ID = "mixer";

// Combined deck state type (persisted + runtime)
export type DeckState = {
  radio: Radio | null;
  soundId: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
  volume: number;
  muted: boolean;
  pan: number;
  speed: number;
  channelFilter: number;
  effects: EffectConfig[];
  filter: FilterConfig;
  effectsDryWet: number;
  repeat: boolean;
};

// Generic hook to get deck persisted state from DB
function useDeckPersisted(deckId: string): DeckRecord | undefined {
  const result = useLiveQuery((q) =>
    q.from({ deck: deckCollection }).where(({ deck }) => eq(deck.id, deckId))
  );
  return result.data?.[0] as DeckRecord | undefined;
}

// Hook to get Deck A persisted state from DB
export function useDeckAPersisted(): DeckRecord | undefined {
  return useDeckPersisted(DECK_A_ID);
}

// Hook to get Deck B persisted state from DB
export function useDeckBPersisted(): DeckRecord | undefined {
  return useDeckPersisted(DECK_B_ID);
}

// Hook to get mixer state from DB
export function useMixer(): MixerRecord | undefined {
  const result = useLiveQuery((q) =>
    q
      .from({ mixer: mixerCollection })
      .where(({ mixer }) => eq(mixer.id, MIXER_ID))
  );
  return result.data?.[0] as MixerRecord | undefined;
}

// Helper to combine persisted and runtime state into DeckState
function combineDeckState(
  persisted: DeckRecord | undefined,
  runtime: ReturnType<typeof useDeckARuntimeState>
): DeckState | null {
  if (!persisted) {
    return null;
  }

  return {
    radio: persisted.radio as Radio | null,
    soundId: runtime.soundId,
    isPlaying: runtime.isPlaying,
    isLoading: runtime.isLoading,
    isBuffering: runtime.isBuffering,
    volume: persisted.volume,
    muted: persisted.muted,
    pan: persisted.pan,
    speed: persisted.speed,
    channelFilter: persisted.channelFilter,
    effects: persisted.effects as unknown as EffectConfig[],
    filter: persisted.filter as FilterConfig,
    effectsDryWet: persisted.effectsDryWet,
    repeat: persisted.repeat,
  };
}

// Combined Deck A state (persisted + runtime)
export function useDeckA(): DeckState | null {
  const persisted = useDeckAPersisted();
  const runtime = useDeckARuntimeState();
  return combineDeckState(persisted, runtime);
}

// Combined Deck B state (persisted + runtime)
export function useDeckB(): DeckState | null {
  const persisted = useDeckBPersisted();
  const runtime = useDeckBRuntimeState();
  return combineDeckState(persisted, runtime);
}

// Get both decks
export function useDecks() {
  const deckA = useDeckA();
  const deckB = useDeckB();
  return { deckA, deckB };
}

// Re-export runtime hooks
export {
  useActiveDragRadio,
  useDeckAIsLoading,
  useDeckAIsPlaying,
  useDeckASoundId,
  useDeckBIsLoading,
  useDeckBIsPlaying,
  useDeckBSoundId,
  useDjError,
  usePendingPlatformItem,
} from "@/lib/stores/dj-runtime-store";

// NOTE: All deck/mixer action functions (setDeckAVolume, setDeckBVolume, etc.)
// should be imported from "@/lib/dj-actions" which properly syncs with the audio manager.
// The functions below are UI-only actions that write to the runtime store.

// UI actions (write to runtime store)
export function setActiveDragRadio(radio: Radio | null) {
  setActiveDragRadioStore(radio);
}

export function setPendingPlatformItem(
  item: { deckId: DeckId; platform: Platform } | null
) {
  setPendingPlatformItemStore(item);
}

// Export runtime state setters for use in actions
export {
  getDeckARuntime,
  getDeckBRuntime,
  resetDeckARuntime,
  resetDeckBRuntime,
  setDeckARuntimeState,
  setDeckASoundId,
  setDeckASubscriptionCleanup,
  setDeckBRuntimeState,
  setDeckBSoundId,
  setDeckBSubscriptionCleanup,
  setDjError,
} from "@/lib/stores/dj-runtime-store";

// Reset functions (combines DB and runtime)
export function resetDeck(deckId: "deck-a" | "deck-b") {
  resetDeckDb(deckId);
  if (deckId === "deck-a") {
    resetDeckARuntime();
  } else {
    resetDeckBRuntime();
  }
}

export function resetAllDjState() {
  resetAllDjStateDb();
  resetAllDjRuntime();
}

// Helper to get deck state synchronously (for non-React contexts)
function getDeckState(
  deckId: string,
  getRuntime: typeof getDeckARuntime
): DeckState | null {
  const deck = deckCollection.state.get(deckId);
  const runtime = getRuntime();

  if (!deck) {
    return null;
  }

  return {
    radio: deck.radio as Radio | null,
    soundId: runtime.soundId,
    isPlaying: runtime.isPlaying,
    isLoading: runtime.isLoading,
    isBuffering: runtime.isBuffering,
    volume: deck.volume,
    muted: deck.muted,
    pan: deck.pan,
    speed: deck.speed,
    channelFilter: deck.channelFilter,
    effects: deck.effects as unknown as EffectConfig[],
    filter: deck.filter as FilterConfig,
    effectsDryWet: deck.effectsDryWet,
    repeat: deck.repeat,
  };
}

// Direct state access for non-React contexts
export function getDeckAState(): DeckState | null {
  return getDeckState(DECK_A_ID, getDeckARuntime);
}

export function getDeckBState(): DeckState | null {
  return getDeckState(DECK_B_ID, getDeckBRuntime);
}

export function getMixerState(): MixerRecord | undefined {
  return mixerCollection.state.get(MIXER_ID);
}

// Re-export DB mutation functions for advanced use
export { updateDeckA, updateDeckB, updateMixer } from "@/lib/collections";
