import { Store, useStore } from "@tanstack/react-store";
import type { Radio } from "@/lib/audio";
import {
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
} from "@/lib/collections/playback-sessions";
import {
  getPlaybackChannelRuntime,
  type RuntimePeakLevel,
  resetAllPlaybackRuntime,
  setPlaybackChannelPeakLevel,
  usePlaybackChannelRuntime,
} from "./playback-runtime-store";

type DjUiState = {
  activeDragRadio: Radio | null;
  error: string | null;
  errorChannelId: string | null;
};

const djUiStore = new Store<DjUiState>({
  activeDragRadio: null,
  error: null,
  errorChannelId: null,
});

export function useDeckAPeakLevel(): RuntimePeakLevel {
  return usePlaybackChannelRuntime(DECK_A_CHANNEL_ID).peakLevel;
}

export function useDeckBPeakLevel(): RuntimePeakLevel {
  return usePlaybackChannelRuntime(DECK_B_CHANNEL_ID).peakLevel;
}

export function useActiveDragRadio() {
  return useStore(djUiStore, (state) => state.activeDragRadio);
}

export function useDjError() {
  return useStore(djUiStore, (state) => state.error);
}

export function getDjError() {
  return djUiStore.state.error;
}

export function setActiveDragRadio(radio: Radio | null) {
  djUiStore.setState((state) => ({ ...state, activeDragRadio: radio }));
}

export function setDeckAPeakLevel(level: RuntimePeakLevel) {
  setPlaybackChannelPeakLevel(DECK_A_CHANNEL_ID, level);
}

export function setDeckBPeakLevel(level: RuntimePeakLevel) {
  setPlaybackChannelPeakLevel(DECK_B_CHANNEL_ID, level);
}

export function setDjError(
  error: string | null,
  channelId: string | null = null
) {
  djUiStore.setState((state) => ({
    ...state,
    error,
    errorChannelId: error ? channelId : null,
  }));
}

export function resetAllDjRuntime() {
  resetAllPlaybackRuntime();
  djUiStore.setState(() => ({
    activeDragRadio: null,
    error: null,
    errorChannelId: null,
  }));
}

export function getDjRuntimeState() {
  return {
    deckA: getPlaybackChannelRuntime(DECK_A_CHANNEL_ID),
    deckB: getPlaybackChannelRuntime(DECK_B_CHANNEL_ID),
    ui: {
      activeDragRadio: djUiStore.state.activeDragRadio,
    },
    deckAPeakLevel: getPlaybackChannelRuntime(DECK_A_CHANNEL_ID).peakLevel,
    deckBPeakLevel: getPlaybackChannelRuntime(DECK_B_CHANNEL_ID).peakLevel,
    error: djUiStore.state.error,
    errorChannelId: djUiStore.state.errorChannelId,
  };
}

export function getDeckARuntime() {
  return getPlaybackChannelRuntime(DECK_A_CHANNEL_ID);
}

export function getDeckBRuntime() {
  return getPlaybackChannelRuntime(DECK_B_CHANNEL_ID);
}
