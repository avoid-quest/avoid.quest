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
  return useStore(
    playbackRuntimeStore,
    (state) => state.channels[channelId] ?? initialChannelRuntimeState
  );
}

export function getPlaybackChannelRuntime(
  channelId: string
): ChannelRuntimeState {
  return ensureChannelState(channelId);
}

export function getPlaybackRuntimeChannelIds(): string[] {
  return Object.keys(playbackRuntimeStore.state.channels);
}

export function updatePlaybackChannelRuntime(
  channelId: string,
  updater: (state: ChannelRuntimeState) => Partial<ChannelRuntimeState>
): void {
  playbackRuntimeStore.setState((state) => {
    const current = state.channels[channelId] ?? {
      ...initialChannelRuntimeState,
      peakLevel: { ...initialChannelRuntimeState.peakLevel },
    };
    const nextChannel = {
      ...current,
      ...updater(current),
    };
    return {
      ...state,
      channels: {
        ...state.channels,
        [channelId]: nextChannel,
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
  playbackRuntimeStore.setState((state) => {
    const nextChannels = { ...state.channels };
    delete nextChannels[channelId];
    return {
      ...state,
      channels: nextChannels,
    };
  });
}

export function resetPlaybackRuntimeForChannels(channelIds: string[]): void {
  for (const channelId of channelIds) {
    resetPlaybackChannelRuntime(channelId);
  }
}

export function resetAllPlaybackRuntime(): void {
  playbackRuntimeStore.setState(() => ({
    channels: {},
  }));
}
