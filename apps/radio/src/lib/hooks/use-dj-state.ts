import { eq, useLiveQuery } from "@tanstack/react-db";
import type { EffectConfig, FilterConfig, Radio } from "@/lib/audio";
import {
  type DeckRecord,
  deckCollection,
  type MixerRecord,
  mixerCollection,
  resetAllDjState as resetAllDjStateDb,
  resetDeck as resetDeckDb,
  updateDeckA as updateDeckADb,
  updateDeckB as updateDeckBDb,
  updateMixer as updateMixerDb,
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
};

// Hook to get Deck A persisted state from DB
export function useDeckAPersisted(): DeckRecord | undefined {
  const { data } = useLiveQuery((q) =>
    q.from({ deck: deckCollection }).where(({ deck }) => eq(deck.id, DECK_A_ID))
  );
  return data?.[0] as DeckRecord | undefined;
}

// Hook to get Deck B persisted state from DB
export function useDeckBPersisted(): DeckRecord | undefined {
  const { data } = useLiveQuery((q) =>
    q.from({ deck: deckCollection }).where(({ deck }) => eq(deck.id, DECK_B_ID))
  );
  return data?.[0] as DeckRecord | undefined;
}

// Hook to get mixer state from DB
export function useMixer(): MixerRecord | undefined {
  const { data } = useLiveQuery((q) =>
    q
      .from({ mixer: mixerCollection })
      .where(({ mixer }) => eq(mixer.id, MIXER_ID))
  );
  return data?.[0] as MixerRecord | undefined;
}

// Combined Deck A state (persisted + runtime)
export function useDeckA(): DeckState | null {
  const persisted = useDeckAPersisted();
  const runtime = useDeckARuntimeState();

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
  };
}

// Combined Deck B state (persisted + runtime)
export function useDeckB(): DeckState | null {
  const persisted = useDeckBPersisted();
  const runtime = useDeckBRuntimeState();

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
  };
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

// Actions for updating persisted state (writes to DB collections)

// Deck A volume
export function setDeckAVolume(volume: number) {
  updateDeckADb((draft) => {
    draft.volume = volume;
  });
}

// Deck B volume
export function setDeckBVolume(volume: number) {
  updateDeckBDb((draft) => {
    draft.volume = volume;
  });
}

// Deck A mute
export function setDeckAMute(muted: boolean) {
  updateDeckADb((draft) => {
    draft.muted = muted;
  });
}

// Deck B mute
export function setDeckBMute(muted: boolean) {
  updateDeckBDb((draft) => {
    draft.muted = muted;
  });
}

// Deck A pan
export function setDeckAPan(pan: number) {
  updateDeckADb((draft) => {
    draft.pan = pan;
  });
}

// Deck B pan
export function setDeckBPan(pan: number) {
  updateDeckBDb((draft) => {
    draft.pan = pan;
  });
}

// Deck A speed
export function setDeckASpeed(speed: number) {
  updateDeckADb((draft) => {
    draft.speed = speed;
  });
}

// Deck B speed
export function setDeckBSpeed(speed: number) {
  updateDeckBDb((draft) => {
    draft.speed = speed;
  });
}

// Deck A channel filter
export function setDeckAChannelFilter(value: number) {
  updateDeckADb((draft) => {
    draft.channelFilter = value;
  });
}

// Deck B channel filter
export function setDeckBChannelFilter(value: number) {
  updateDeckBDb((draft) => {
    draft.channelFilter = value;
  });
}

// Deck A effects dry/wet
export function setDeckAEffectsDryWet(value: number) {
  updateDeckADb((draft) => {
    draft.effectsDryWet = value;
  });
}

// Deck B effects dry/wet
export function setDeckBEffectsDryWet(value: number) {
  updateDeckBDb((draft) => {
    draft.effectsDryWet = value;
  });
}

// Deck A filter
export function updateDeckAFilter(filter: FilterConfig) {
  updateDeckADb((draft) => {
    draft.filter = filter;
  });
}

// Deck B filter
export function updateDeckBFilter(filter: FilterConfig) {
  updateDeckBDb((draft) => {
    draft.filter = filter;
  });
}

// Deck A effects
export function addDeckAEffect(effect: EffectConfig) {
  updateDeckADb((draft) => {
    (draft.effects as unknown as EffectConfig[]).push(effect);
  });
}

export function updateDeckAEffect(
  effectId: string,
  config: Partial<EffectConfig>
) {
  updateDeckADb((draft) => {
    const effects = draft.effects as unknown as EffectConfig[];
    const idx = effects.findIndex((e) => e.id === effectId);
    if (idx !== -1) {
      const effect = effects[idx];
      if (effect) {
        effects[idx] = { ...effect, ...config } as EffectConfig;
      }
    }
  });
}

export function removeDeckAEffect(effectId: string) {
  updateDeckADb((draft) => {
    const effects = draft.effects as unknown as EffectConfig[];
    draft.effects = effects.filter(
      (e) => e.id !== effectId
    ) as unknown as typeof draft.effects;
  });
}

export function reorderDeckAEffects(effectIds: string[]) {
  updateDeckADb((draft) => {
    const effects = draft.effects as unknown as EffectConfig[];
    const newEffects: EffectConfig[] = [];
    for (const id of effectIds) {
      const effect = effects.find((e) => e.id === id);
      if (effect) {
        newEffects.push(effect);
      }
    }
    draft.effects = newEffects as unknown as typeof draft.effects;
  });
}

// Deck B effects
export function addDeckBEffect(effect: EffectConfig) {
  updateDeckBDb((draft) => {
    (draft.effects as unknown as EffectConfig[]).push(effect);
  });
}

export function updateDeckBEffect(
  effectId: string,
  config: Partial<EffectConfig>
) {
  updateDeckBDb((draft) => {
    const effects = draft.effects as unknown as EffectConfig[];
    const idx = effects.findIndex((e) => e.id === effectId);
    if (idx !== -1) {
      const effect = effects[idx];
      if (effect) {
        effects[idx] = { ...effect, ...config } as EffectConfig;
      }
    }
  });
}

export function removeDeckBEffect(effectId: string) {
  updateDeckBDb((draft) => {
    const effects = draft.effects as unknown as EffectConfig[];
    draft.effects = effects.filter(
      (e) => e.id !== effectId
    ) as unknown as typeof draft.effects;
  });
}

export function reorderDeckBEffects(effectIds: string[]) {
  updateDeckBDb((draft) => {
    const effects = draft.effects as unknown as EffectConfig[];
    const newEffects: EffectConfig[] = [];
    for (const id of effectIds) {
      const effect = effects.find((e) => e.id === id);
      if (effect) {
        newEffects.push(effect);
      }
    }
    draft.effects = newEffects as unknown as typeof draft.effects;
  });
}

// Deck A radio (persisted)
export function setDeckARadio(radio: Radio | null) {
  updateDeckADb((draft) => {
    draft.radio = radio;
  });
}

// Deck B radio (persisted)
export function setDeckBRadio(radio: Radio | null) {
  updateDeckBDb((draft) => {
    draft.radio = radio;
  });
}

// Mixer controls
export function setCrossfadePosition(position: number) {
  updateMixerDb((draft) => {
    draft.crossfadePosition = position;
  });
}

export function setMasterVolume(volume: number) {
  updateMixerDb((draft) => {
    draft.masterVolume = volume;
  });
}

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

// Direct state access for non-React contexts
export function getDeckAState(): DeckState | null {
  const deckA = deckCollection.state.get(DECK_A_ID);
  const runtime = getDeckARuntime();

  if (!deckA) {
    return null;
  }

  return {
    radio: deckA.radio as Radio | null,
    soundId: runtime.soundId,
    isPlaying: runtime.isPlaying,
    isLoading: runtime.isLoading,
    isBuffering: runtime.isBuffering,
    volume: deckA.volume,
    muted: deckA.muted,
    pan: deckA.pan,
    speed: deckA.speed,
    channelFilter: deckA.channelFilter,
    effects: deckA.effects as unknown as EffectConfig[],
    filter: deckA.filter as FilterConfig,
    effectsDryWet: deckA.effectsDryWet,
  };
}

export function getDeckBState(): DeckState | null {
  const deckB = deckCollection.state.get(DECK_B_ID);
  const runtime = getDeckBRuntime();

  if (!deckB) {
    return null;
  }

  return {
    radio: deckB.radio as Radio | null,
    soundId: runtime.soundId,
    isPlaying: runtime.isPlaying,
    isLoading: runtime.isLoading,
    isBuffering: runtime.isBuffering,
    volume: deckB.volume,
    muted: deckB.muted,
    pan: deckB.pan,
    speed: deckB.speed,
    channelFilter: deckB.channelFilter,
    effects: deckB.effects as unknown as EffectConfig[],
    filter: deckB.filter as FilterConfig,
    effectsDryWet: deckB.effectsDryWet,
  };
}

export function getMixerState(): MixerRecord | undefined {
  return mixerCollection.state.get(MIXER_ID);
}

// Re-export DB mutation functions for advanced use
export { updateDeckA, updateDeckB, updateMixer } from "@/lib/collections";
