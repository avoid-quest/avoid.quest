import { Store, shallow, useStore } from "@tanstack/react-store";
import { useSyncExternalStore } from "react";
import type { AudioError } from "@/lib/audio";

export type RuntimePeakLevel = { left: number; right: number };

export type PeakLevelSource = {
  getSnapshot: () => RuntimePeakLevel;
  subscribe: (listener: (level: RuntimePeakLevel) => void) => () => void;
};

const silentPeak: RuntimePeakLevel = { left: 0, right: 0 };
const peakLevels = new Map<string, RuntimePeakLevel>();
const peakListeners = new Map<string, Set<(level: RuntimePeakLevel) => void>>();
const meterSources = new Map<string, PeakLevelSource>();

export function getPlaybackChannelMeterSource(
  channelId: string
): PeakLevelSource {
  let source = meterSources.get(channelId);
  if (!source) {
    source = {
      getSnapshot: () => peakLevels.get(channelId) ?? silentPeak,
      subscribe(listener) {
        const listeners = peakListeners.get(channelId) ?? new Set();
        peakListeners.set(channelId, listeners);
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) {
            peakListeners.delete(channelId);
          }
        };
      },
    };
    meterSources.set(channelId, source);
  }
  return source;
}

export function usePlaybackChannelPeakLevel(
  channelId: string
): RuntimePeakLevel {
  const source = getPlaybackChannelMeterSource(channelId);
  return useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    source.getSnapshot
  );
}

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
  const runtime = ensureChannelState(channelId);
  const peakLevel = peakLevels.get(channelId);
  return peakLevel ? { ...runtime, peakLevel } : runtime;
}

export function getPlaybackRuntimeChannelIds(): string[] {
  return Object.keys(playbackRuntimeStore.state.channels);
}

export function setPlaybackChannelRuntime(
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

export function setPlaybackChannelSoundId(
  channelId: string,
  soundId: string | null
): void {
  setPlaybackChannelRuntime(channelId, () => ({ soundId }));
}

export function setPlaybackChannelPeakLevel(
  channelId: string,
  peakLevel: RuntimePeakLevel
): void {
  peakLevels.set(channelId, peakLevel);
  for (const listener of peakListeners.get(channelId) ?? []) {
    listener(peakLevel);
  }
}

export function resetPlaybackChannelRuntime(channelId: string): void {
  setPlaybackChannelPeakLevel(channelId, silentPeak);
  peakLevels.delete(channelId);
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
  for (const channelId of peakLevels.keys()) {
    setPlaybackChannelPeakLevel(channelId, silentPeak);
  }
  peakLevels.clear();
  playbackRuntimeStore.setState(() => ({
    channels: {},
  }));
}
