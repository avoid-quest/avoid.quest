import type { StateCreator } from "zustand";
import { createDeckLoadingActions } from "./deck-loading-actions";
import { createDeckPlaybackActions } from "./deck-playback-actions";
import { createDeckVolumeActions } from "./deck-volume-actions";
import type { InternalDjState } from "./types";

/**
 * Composes all deck-related actions into a single action creator.
 * This file serves as the main entry point for deck actions, combining:
 * - Loading actions (setLeftRadio, setRightRadio, resetLeft, resetRight, cleanupAll)
 * - Playback actions (playLeft, playRight, pauseLeft, pauseRight)
 * - Volume actions (setLeftVolume, setRightVolume, setLeftMute, setRightMute)
 */
export const createDeckActions: StateCreator<
  InternalDjState,
  [],
  [],
  Pick<
    InternalDjState,
    | "setLeftRadio"
    | "setRightRadio"
    | "playLeft"
    | "pauseLeft"
    | "playRight"
    | "pauseRight"
    | "setLeftVolume"
    | "setRightVolume"
    | "setLeftMute"
    | "setRightMute"
    | "resetLeft"
    | "resetRight"
    | "cleanupAll"
  >
> = (set, get, api) => ({
  ...createDeckLoadingActions(set, get, api),
  ...createDeckPlaybackActions(set, get, api),
  ...createDeckVolumeActions(set, get, api),
});
