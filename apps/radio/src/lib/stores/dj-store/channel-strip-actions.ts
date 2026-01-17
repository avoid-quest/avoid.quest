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
    const { deckA } = get();
    set((state) => ({
      deckA: { ...state.deckA, pan },
    }));
    if (deckA.soundId && deckA.isPlaying && !deckA.isLoading) {
      getAudioManager().setPan(deckA.soundId, pan);
    }
  },

  setRightPan: (pan: number) => {
    const { deckB } = get();
    set((state) => ({
      deckB: { ...state.deckB, pan },
    }));
    if (deckB.soundId && deckB.isPlaying && !deckB.isLoading) {
      getAudioManager().setPan(deckB.soundId, pan);
    }
  },

  setLeftSpeed: (speed: number) => {
    const { deckA } = get();
    set((state) => ({
      deckA: { ...state.deckA, speed },
    }));
    if (deckA.soundId && deckA.isPlaying && !deckA.isLoading) {
      getAudioManager().setPlaybackRate(deckA.soundId, speed);
    }
  },

  setRightSpeed: (speed: number) => {
    const { deckB } = get();
    set((state) => ({
      deckB: { ...state.deckB, speed },
    }));
    if (deckB.soundId && deckB.isPlaying && !deckB.isLoading) {
      getAudioManager().setPlaybackRate(deckB.soundId, speed);
    }
  },

  setLeftChannelFilter: (value: number) => {
    const { deckA } = get();
    set((state) => ({
      deckA: { ...state.deckA, channelFilter: value },
    }));
    if (deckA.soundId && deckA.isPlaying && !deckA.isLoading) {
      getAudioManager().setChannelFilter(deckA.soundId, value);
    }
  },

  setRightChannelFilter: (value: number) => {
    const { deckB } = get();
    set((state) => ({
      deckB: { ...state.deckB, channelFilter: value },
    }));
    if (deckB.soundId && deckB.isPlaying && !deckB.isLoading) {
      getAudioManager().setChannelFilter(deckB.soundId, value);
    }
  },

  setLeftEffectsDryWet: (value: number) => {
    const { deckA } = get();
    set((state) => ({
      deckA: { ...state.deckA, effectsDryWet: value },
    }));
    if (deckA.soundId && deckA.isPlaying && !deckA.isLoading) {
      getAudioManager().setEffectsDryWet(deckA.soundId, value);
    }
  },

  setRightEffectsDryWet: (value: number) => {
    const { deckB } = get();
    set((state) => ({
      deckB: { ...state.deckB, effectsDryWet: value },
    }));
    if (deckB.soundId && deckB.isPlaying && !deckB.isLoading) {
      getAudioManager().setEffectsDryWet(deckB.soundId, value);
    }
  },
});
