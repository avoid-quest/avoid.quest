export * from "./audio-manager-helpers";
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
import {
  createDeckActions,
  createEffectsActions,
  createMixerActions,
  createTrackActions,
  createUiActions,
  type DjState,
  initialDeckState,
} from "./index";

export const useDjStore = create<DjState>((set, get, api) => ({
  // Initial State
  leftDeck: { ...initialDeckState },
  rightDeck: { ...initialDeckState },
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
}));
