export * from "./audio-manager-helpers";
export * from "./channel-strip-actions";
export * from "./deck-actions";
export * from "./deck-loading-actions";
export * from "./deck-playback-actions";
export * from "./deck-volume-actions";
export * from "./effects-actions";
export * from "./mixer-actions";
export * from "./track-actions";
export * from "./types";
export * from "./ui-actions";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createChannelStripActions } from "./channel-strip-actions";
import { createDeckActions } from "./deck-actions";
import { createEffectsActions } from "./effects-actions";
import { createMixerActions } from "./mixer-actions";
import { createTrackActions } from "./track-actions";
import {
  type DeckState,
  type InternalDjState,
  initialDeckState,
} from "./types";
import { createUiActions } from "./ui-actions";

// Extract only the persistable state from a deck (excludes runtime state)
const extractDeckState = (deck: DeckState) => ({
  // Source
  radio: deck.radio,
  // Channel Strip
  volume: deck.volume,
  muted: deck.muted,
  pan: deck.pan,
  speed: deck.speed,
  channelFilter: deck.channelFilter,
  // Effects
  effects: deck.effects,
  filter: deck.filter,
  effectsDryWet: deck.effectsDryWet,
});

export const useDjStore = create<InternalDjState>()(
  persist(
    (set, get, api) => ({
      // Initial State
      deckA: { ...initialDeckState },
      deckB: { ...initialDeckState },
      mixer: {
        crossfadePosition: 0.5,
        masterVolume: 1,
      },
      ui: {
        activeDragRadio: null,
        pendingPlatformItem: null,
      },
      error: null,
      _subscriptionCleanup: {
        left: null,
        right: null,
      },

      // Compose all action creators
      ...createDeckActions(set, get, api),
      ...createMixerActions(set, get, api),
      ...createEffectsActions(set, get, api),
      ...createTrackActions(set, get, api),
      ...createUiActions(set, get, api),
      ...createChannelStripActions(set, get, api),
    }),
    {
      name: "radio-dj-store",
      skipHydration: true,
      partialize: (state) => ({
        deckA: extractDeckState(state.deckA),
        deckB: extractDeckState(state.deckB),
        mixer: state.mixer,
      }),
      merge: (persisted, current) => ({
        ...current,
        deckA: {
          ...current.deckA,
          ...(persisted as Partial<InternalDjState>)?.deckA,
        },
        deckB: {
          ...current.deckB,
          ...(persisted as Partial<InternalDjState>)?.deckB,
        },
        mixer: {
          ...current.mixer,
          ...(persisted as Partial<InternalDjState>)?.mixer,
        },
      }),
    }
  )
);
