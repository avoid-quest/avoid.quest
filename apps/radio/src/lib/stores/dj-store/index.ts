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
import { createChannelStripActions } from "./channel-strip-actions";
import { createDeckActions } from "./deck-actions";
import { createEffectsActions } from "./effects-actions";
import { createMixerActions } from "./mixer-actions";
import { createTrackActions } from "./track-actions";
import { type InternalDjState, initialDeckState } from "./types";
import { createUiActions } from "./ui-actions";

export const useDjStore = create<InternalDjState>((set, get, api) => ({
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
}));
