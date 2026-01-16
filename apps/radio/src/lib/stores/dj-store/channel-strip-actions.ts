import type { StateCreator } from "zustand";
import { getAudioManager } from "./audio-manager-helpers";
import type { InternalDjState } from "./types";

export const createChannelStripActions: StateCreator<
  InternalDjState,
  [],
  [],
  Pick<
    InternalDjState,
    | "setLeftPan"
    | "setRightPan"
    | "setLeftSpeed"
    | "setRightSpeed"
    | "setLeftChannelFilter"
    | "setRightChannelFilter"
    | "setLeftEffectsDryWet"
    | "setRightEffectsDryWet"
  >
> = (set, get) => ({
  setLeftPan: (pan: number) => {
    const { leftDeck } = get();
    set((state) => ({
      leftDeck: { ...state.leftDeck, pan },
    }));
    if (leftDeck.soundId) {
      getAudioManager().setPan(leftDeck.soundId, pan);
    }
  },

  setRightPan: (pan: number) => {
    const { rightDeck } = get();
    set((state) => ({
      rightDeck: { ...state.rightDeck, pan },
    }));
    if (rightDeck.soundId) {
      getAudioManager().setPan(rightDeck.soundId, pan);
    }
  },

  setLeftSpeed: (speed: number) => {
    const { leftDeck } = get();
    set((state) => ({
      leftDeck: { ...state.leftDeck, speed },
    }));
    if (leftDeck.soundId) {
      getAudioManager().setPlaybackRate(leftDeck.soundId, speed);
    }
  },

  setRightSpeed: (speed: number) => {
    const { rightDeck } = get();
    set((state) => ({
      rightDeck: { ...state.rightDeck, speed },
    }));
    if (rightDeck.soundId) {
      getAudioManager().setPlaybackRate(rightDeck.soundId, speed);
    }
  },

  setLeftChannelFilter: (value: number) => {
    const { leftDeck } = get();
    set((state) => ({
      leftDeck: { ...state.leftDeck, channelFilter: value },
    }));
    if (leftDeck.soundId) {
      getAudioManager().setChannelFilter(leftDeck.soundId, value);
    }
  },

  setRightChannelFilter: (value: number) => {
    const { rightDeck } = get();
    set((state) => ({
      rightDeck: { ...state.rightDeck, channelFilter: value },
    }));
    if (rightDeck.soundId) {
      getAudioManager().setChannelFilter(rightDeck.soundId, value);
    }
  },

  setLeftEffectsDryWet: (value: number) => {
    const { leftDeck } = get();
    set((state) => ({
      leftDeck: { ...state.leftDeck, effectsDryWet: value },
    }));
    if (leftDeck.soundId) {
      getAudioManager().setEffectsDryWet(leftDeck.soundId, value);
    }
  },

  setRightEffectsDryWet: (value: number) => {
    const { rightDeck } = get();
    set((state) => ({
      rightDeck: { ...state.rightDeck, effectsDryWet: value },
    }));
    if (rightDeck.soundId) {
      getAudioManager().setEffectsDryWet(rightDeck.soundId, value);
    }
  },
});
