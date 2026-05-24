import { Store, useStore } from "@tanstack/react-store";
import type { Radio } from "@/lib/audio";
import {
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
} from "@/lib/collections/playback-sessions";
import type { Platform } from "@/lib/platform-types";
import {
  getPlaybackChannelRuntime,
  type RuntimePeakLevel,
  resetAllPlaybackRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelPeakLevel,
  setPlaybackChannelRuntime,
  setPlaybackChannelSoundId,
  usePlaybackChannelRuntime,
} from "./playback-runtime-store";

export type DeckId = "deck-a" | "deck-b";

type DeckRuntimeState = ReturnType<typeof getPlaybackChannelRuntime>;

export type PendingPlatformItem = {
  deckId: DeckId;
  platform: Platform | "external";
} | null;

type DjUiState = {
  activeDragRadio: Radio | null;
  pendingPlatformItem: PendingPlatformItem;
  error: string | null;
  errorChannelId: string | null;
};

const djUiStore = new Store<DjUiState>({
  activeDragRadio: null,
  pendingPlatformItem: null,
  error: null,
  errorChannelId: null,
});

export function useDeckARuntimeState() {
  return usePlaybackChannelRuntime(DECK_A_CHANNEL_ID);
}

export function useDeckBRuntimeState() {
  return usePlaybackChannelRuntime(DECK_B_CHANNEL_ID);
}

export function useDeckAIsPlaying() {
  return usePlaybackChannelRuntime(DECK_A_CHANNEL_ID).isPlaying;
}

export function useDeckAIsLoading() {
  return usePlaybackChannelRuntime(DECK_A_CHANNEL_ID).isLoading;
}

export function useDeckASoundId() {
  return usePlaybackChannelRuntime(DECK_A_CHANNEL_ID).soundId;
}

export function useDeckBIsPlaying() {
  return usePlaybackChannelRuntime(DECK_B_CHANNEL_ID).isPlaying;
}

export function useDeckBIsLoading() {
  return usePlaybackChannelRuntime(DECK_B_CHANNEL_ID).isLoading;
}

export function useDeckBSoundId() {
  return usePlaybackChannelRuntime(DECK_B_CHANNEL_ID).soundId;
}

export function useDeckAPeakLevel(): RuntimePeakLevel {
  return usePlaybackChannelRuntime(DECK_A_CHANNEL_ID).peakLevel;
}

export function useDeckBPeakLevel(): RuntimePeakLevel {
  return usePlaybackChannelRuntime(DECK_B_CHANNEL_ID).peakLevel;
}

export function useActiveDragRadio() {
  return useStore(djUiStore, (state) => state.activeDragRadio);
}

export function usePendingPlatformItem() {
  return useStore(djUiStore, (state) => state.pendingPlatformItem);
}

export function useDjError() {
  return useStore(djUiStore, (state) => state.error);
}

export function getDjError() {
  return djUiStore.state.error;
}

export function setDeckARuntimeState(
  updater: (state: DeckRuntimeState) => Partial<DeckRuntimeState>
) {
  setPlaybackChannelRuntime(DECK_A_CHANNEL_ID, updater);
}

export function setDeckBRuntimeState(
  updater: (state: DeckRuntimeState) => Partial<DeckRuntimeState>
) {
  setPlaybackChannelRuntime(DECK_B_CHANNEL_ID, updater);
}

export function setDeckASoundId(soundId: string | null) {
  setPlaybackChannelSoundId(DECK_A_CHANNEL_ID, soundId);
}

export function setDeckBSoundId(soundId: string | null) {
  setPlaybackChannelSoundId(DECK_B_CHANNEL_ID, soundId);
}

export function setActiveDragRadio(radio: Radio | null) {
  djUiStore.setState((state) => ({ ...state, activeDragRadio: radio }));
}

export function setPendingPlatformItem(item: PendingPlatformItem) {
  djUiStore.setState((state) => ({ ...state, pendingPlatformItem: item }));
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

export function resetDeckARuntime() {
  resetPlaybackChannelRuntime(DECK_A_CHANNEL_ID);
}

export function resetDeckBRuntime() {
  resetPlaybackChannelRuntime(DECK_B_CHANNEL_ID);
}

export function resetAllDjRuntime() {
  resetAllPlaybackRuntime();
  djUiStore.setState(() => ({
    activeDragRadio: null,
    pendingPlatformItem: null,
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
      pendingPlatformItem: djUiStore.state.pendingPlatformItem,
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
