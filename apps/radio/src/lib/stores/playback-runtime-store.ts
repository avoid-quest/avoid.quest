import { Store, useStore } from "@tanstack/react-store";
import type { AudioError } from "@/lib/audio";

export type RuntimePeakLevel = { left: number; right: number };

export type ChannelRuntimeState = {
  soundId: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
  error: AudioError | null;
  peakLevel: RuntimePeakLevel;
};

type PlaybackRuntimeState = {
  channels: Record<string, ChannelRuntimeState>;
  subscriptions: Record<string, (() => void) | null>;
};

export const initialChannelRuntimeState: ChannelRuntimeState = {
  soundId: null,
  isPlaying: false,
  isLoading: false,
  isBuffering: false,
  error: null,
  peakLevel: { left: 0, right: 0 },
};

export const playbackRuntimeStore = new Store<PlaybackRuntimeState>({
  channels: {},
  subscriptions: {},
});

function ensureChannelState(channelId: string): ChannelRuntimeState {
  return (
    playbackRuntimeStore.state.channels[channelId] ?? {
      ...initialChannelRuntimeState,
      peakLevel: { ...initialChannelRuntimeState.peakLevel },
    }
  );
}

export function usePlaybackChannelRuntime(channelId: string) {
  return useStore(playbackRuntimeStore, (state) => {
    return state.channels[channelId] ?? initialChannelRuntimeState;
  });
}

export function getPlaybackChannelRuntime(
  channelId: string
): ChannelRuntimeState {
  return ensureChannelState(channelId);
}

export function updatePlaybackChannelRuntime(
  channelId: string,
  updater: (state: ChannelRuntimeState) => Partial<ChannelRuntimeState>
): void {
  playbackRuntimeStore.setState((state) => {
    const current = state.channels[channelId] ?? ensureChannelState(channelId);
    return {
      ...state,
      channels: {
        ...state.channels,
        [channelId]: {
          ...current,
          ...updater(current),
        },
      },
    };
  });
}

export const setPlaybackChannelRuntime = updatePlaybackChannelRuntime;

export function setPlaybackChannelSoundId(
  channelId: string,
  soundId: string | null
): void {
  updatePlaybackChannelRuntime(channelId, () => ({ soundId }));
}

export function setPlaybackChannelPeakLevel(
  channelId: string,
  peakLevel: RuntimePeakLevel
): void {
  updatePlaybackChannelRuntime(channelId, () => ({ peakLevel }));
}

export function resetPlaybackChannelRuntime(channelId: string): void {
  const cleanup = playbackRuntimeStore.state.subscriptions[channelId];
  if (cleanup) {
    cleanup();
  }
  playbackRuntimeStore.setState((state) => {
    const nextChannels = { ...state.channels };
    delete nextChannels[channelId];
    const nextSubscriptions = { ...state.subscriptions };
    delete nextSubscriptions[channelId];
    return {
      ...state,
      channels: nextChannels,
      subscriptions: nextSubscriptions,
    };
  });
}

export function resetPlaybackRuntimeForChannels(channelIds: string[]): void {
  for (const channelId of channelIds) {
    resetPlaybackChannelRuntime(channelId);
  }
}

export function setPlaybackChannelSubscriptionCleanup(
  channelId: string,
  cleanup: (() => void) | null
): void {
  const previous = playbackRuntimeStore.state.subscriptions[channelId];
  if (previous) {
    previous();
  }
  playbackRuntimeStore.setState((state) => ({
    ...state,
    subscriptions: {
      ...state.subscriptions,
      [channelId]: cleanup,
    },
  }));
}

export function getPlaybackChannelSubscriptionCleanup(
  channelId: string
): (() => void) | null {
  return playbackRuntimeStore.state.subscriptions[channelId] ?? null;
}

export function resetAllPlaybackRuntime(): void {
  for (const cleanup of Object.values(
    playbackRuntimeStore.state.subscriptions
  )) {
    cleanup?.();
  }
  playbackRuntimeStore.setState(() => ({
    channels: {},
    subscriptions: {},
  }));
}
