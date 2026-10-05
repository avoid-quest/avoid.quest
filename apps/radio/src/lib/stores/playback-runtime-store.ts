import { Store, shallow, useStore } from "@tanstack/react-store";
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

export type ChannelRuntimeView = Omit<ChannelRuntimeState, "peakLevel">;

type PlaybackRuntimeState = {
  channels: Record<string, ChannelRuntimeState>;
};

export const initialChannelRuntimeState: ChannelRuntimeState = {
  error: null,
  isBuffering: false,
  isLoading: false,
  isPlaying: false,
  peakLevel: { left: 0, right: 0 },
  soundId: null,
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

/** Meters read peaks separately; controls only follow transport state. */
export function selectChannelRuntimeView(
  runtime: ChannelRuntimeState = initialChannelRuntimeState
): ChannelRuntimeView {
  const { error, isBuffering, isLoading, isPlaying, soundId } = runtime;
  return { error, isBuffering, isLoading, isPlaying, soundId };
}

export function usePlaybackChannelRuntimeView(channelId: string) {
  return useStore(
    playbackRuntimeStore,
    (state) => selectChannelRuntimeView(state.channels[channelId]),
    shallow
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
