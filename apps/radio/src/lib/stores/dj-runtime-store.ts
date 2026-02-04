import { Store, useStore } from "@tanstack/react-store";
import type { Radio } from "@/lib/audio";
import type { Platform } from "@/lib/platform-types";

export type DeckId = "deck-a" | "deck-b";

type DeckRuntimeState = {
  soundId: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
};

type SubscriptionCleanup = {
  "deck-a": (() => void) | null;
  "deck-b": (() => void) | null;
};

type PeakLevel = { left: number; right: number };

type DjRuntimeState = {
  deckA: DeckRuntimeState;
  deckB: DeckRuntimeState;
  ui: {
    activeDragRadio: Radio | null;
    pendingPlatformItem: {
      deckId: DeckId;
      platform: Platform;
    } | null;
  };
  deckAPeakLevel: PeakLevel;
  deckBPeakLevel: PeakLevel;
  error: string | null;
  _subscriptionCleanup: SubscriptionCleanup;
};

const initialDeckRuntime: DeckRuntimeState = {
  soundId: null,
  isPlaying: false,
  isLoading: false,
  isBuffering: false,
};

const initialPeakLevel: PeakLevel = { left: 0, right: 0 };

const initialState: DjRuntimeState = {
  deckA: { ...initialDeckRuntime },
  deckB: { ...initialDeckRuntime },
  ui: {
    activeDragRadio: null,
    pendingPlatformItem: null,
  },
  deckAPeakLevel: { ...initialPeakLevel },
  deckBPeakLevel: { ...initialPeakLevel },
  error: null,
  _subscriptionCleanup: {
    "deck-a": null,
    "deck-b": null,
  },
};

// Create the runtime store
export const djRuntimeStore = new Store<DjRuntimeState>(initialState);

// Deck A selectors
export function useDeckARuntimeState() {
  return useStore(djRuntimeStore, (state) => state.deckA);
}

export function useDeckAIsPlaying() {
  return useStore(djRuntimeStore, (state) => state.deckA.isPlaying);
}

export function useDeckAIsLoading() {
  return useStore(djRuntimeStore, (state) => state.deckA.isLoading);
}

export function useDeckASoundId() {
  return useStore(djRuntimeStore, (state) => state.deckA.soundId);
}

// Deck B selectors
export function useDeckBRuntimeState() {
  return useStore(djRuntimeStore, (state) => state.deckB);
}

export function useDeckBIsPlaying() {
  return useStore(djRuntimeStore, (state) => state.deckB.isPlaying);
}

export function useDeckBIsLoading() {
  return useStore(djRuntimeStore, (state) => state.deckB.isLoading);
}

export function useDeckBSoundId() {
  return useStore(djRuntimeStore, (state) => state.deckB.soundId);
}

// Peak level selectors
export function useDeckAPeakLevel() {
  return useStore(djRuntimeStore, (state) => state.deckAPeakLevel);
}

export function useDeckBPeakLevel() {
  return useStore(djRuntimeStore, (state) => state.deckBPeakLevel);
}

// UI selectors
export function useActiveDragRadio() {
  return useStore(djRuntimeStore, (state) => state.ui.activeDragRadio);
}

export function usePendingPlatformItem() {
  return useStore(djRuntimeStore, (state) => state.ui.pendingPlatformItem);
}

export function useDjError() {
  return useStore(djRuntimeStore, (state) => state.error);
}

// Generic deck runtime state setter
function setDeckRuntimeState(
  deck: "deckA" | "deckB",
  updater: (state: DeckRuntimeState) => Partial<DeckRuntimeState>
) {
  djRuntimeStore.setState((state) => ({
    ...state,
    [deck]: { ...state[deck], ...updater(state[deck]) },
  }));
}

// Generic deck property setter
function setDeckProperty<K extends keyof DeckRuntimeState>(
  deck: "deckA" | "deckB",
  key: K,
  value: DeckRuntimeState[K]
) {
  djRuntimeStore.setState((state) => ({
    ...state,
    [deck]: { ...state[deck], [key]: value },
  }));
}

// Deck runtime state setters
export function setDeckARuntimeState(
  updater: (state: DeckRuntimeState) => Partial<DeckRuntimeState>
) {
  setDeckRuntimeState("deckA", updater);
}

export function setDeckBRuntimeState(
  updater: (state: DeckRuntimeState) => Partial<DeckRuntimeState>
) {
  setDeckRuntimeState("deckB", updater);
}

// Set deck soundId
export function setDeckASoundId(soundId: string | null) {
  setDeckProperty("deckA", "soundId", soundId);
}

export function setDeckBSoundId(soundId: string | null) {
  setDeckProperty("deckB", "soundId", soundId);
}

// Set deck playing state
export function setDeckAPlaying(isPlaying: boolean) {
  setDeckProperty("deckA", "isPlaying", isPlaying);
}

export function setDeckBPlaying(isPlaying: boolean) {
  setDeckProperty("deckB", "isPlaying", isPlaying);
}

// Set deck loading state
export function setDeckALoading(isLoading: boolean) {
  setDeckProperty("deckA", "isLoading", isLoading);
}

export function setDeckBLoading(isLoading: boolean) {
  setDeckProperty("deckB", "isLoading", isLoading);
}

// Set deck buffering state
export function setDeckABuffering(isBuffering: boolean) {
  setDeckProperty("deckA", "isBuffering", isBuffering);
}

export function setDeckBBuffering(isBuffering: boolean) {
  setDeckProperty("deckB", "isBuffering", isBuffering);
}

// UI state setters
export function setActiveDragRadio(radio: Radio | null) {
  djRuntimeStore.setState((state) => ({
    ...state,
    ui: { ...state.ui, activeDragRadio: radio },
  }));
}

export function setPendingPlatformItem(
  item: { deckId: DeckId; platform: Platform } | null
) {
  djRuntimeStore.setState((state) => ({
    ...state,
    ui: { ...state.ui, pendingPlatformItem: item },
  }));
}

// Peak level setters
export function setDeckAPeakLevel(level: PeakLevel) {
  djRuntimeStore.setState((state) => ({
    ...state,
    deckAPeakLevel: level,
  }));
}

export function setDeckBPeakLevel(level: PeakLevel) {
  djRuntimeStore.setState((state) => ({
    ...state,
    deckBPeakLevel: level,
  }));
}

// Error setter
export function setDjError(error: string | null) {
  djRuntimeStore.setState((state) => ({
    ...state,
    error,
  }));
}

// Subscription cleanup management
export function setDeckASubscriptionCleanup(cleanup: (() => void) | null) {
  const prev = djRuntimeStore.state._subscriptionCleanup["deck-a"];
  if (prev) {
    prev();
  }
  djRuntimeStore.setState((state) => ({
    ...state,
    _subscriptionCleanup: {
      ...state._subscriptionCleanup,
      "deck-a": cleanup,
    },
  }));
}

export function setDeckBSubscriptionCleanup(cleanup: (() => void) | null) {
  const prev = djRuntimeStore.state._subscriptionCleanup["deck-b"];
  if (prev) {
    prev();
  }
  djRuntimeStore.setState((state) => ({
    ...state,
    _subscriptionCleanup: {
      ...state._subscriptionCleanup,
      "deck-b": cleanup,
    },
  }));
}

// Get current subscription cleanup
export function getDeckASubscriptionCleanup() {
  return djRuntimeStore.state._subscriptionCleanup["deck-a"];
}

export function getDeckBSubscriptionCleanup() {
  return djRuntimeStore.state._subscriptionCleanup["deck-b"];
}

// Reset deck runtime state
export function resetDeckARuntime() {
  const cleanup = djRuntimeStore.state._subscriptionCleanup["deck-a"];
  if (cleanup) {
    cleanup();
  }
  djRuntimeStore.setState((state) => ({
    ...state,
    deckA: { ...initialDeckRuntime },
    _subscriptionCleanup: {
      ...state._subscriptionCleanup,
      "deck-a": null,
    },
  }));
}

export function resetDeckBRuntime() {
  const cleanup = djRuntimeStore.state._subscriptionCleanup["deck-b"];
  if (cleanup) {
    cleanup();
  }
  djRuntimeStore.setState((state) => ({
    ...state,
    deckB: { ...initialDeckRuntime },
    _subscriptionCleanup: {
      ...state._subscriptionCleanup,
      "deck-b": null,
    },
  }));
}

// Reset all runtime state
export function resetAllDjRuntime() {
  const cleanupA = djRuntimeStore.state._subscriptionCleanup["deck-a"];
  const cleanupB = djRuntimeStore.state._subscriptionCleanup["deck-b"];
  if (cleanupA) {
    cleanupA();
  }
  if (cleanupB) {
    cleanupB();
  }
  djRuntimeStore.setState(() => ({ ...initialState }));
}

// Direct state access for non-React contexts
export function getDjRuntimeState() {
  return djRuntimeStore.state;
}

export function getDeckARuntime() {
  return djRuntimeStore.state.deckA;
}

export function getDeckBRuntime() {
  return djRuntimeStore.state.deckB;
}
