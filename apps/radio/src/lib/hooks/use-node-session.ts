import { shallow, useStore } from "@tanstack/react-store";
import type { Radio } from "@/lib/audio";
import type { PlaybackSessionRecord } from "@/lib/collections/playback-sessions";
import { getNodePlayback } from "@/lib/node-playback";
import { isDeviceInputMetadata } from "@/lib/platform-types";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";
import { usePlaybackSessionSelector } from "./use-dj-session";

/** A source lane as the Speakers, Stage and Rack views render it. */
export type NodeSourceState = {
  /** The Station, Track, File or Audio input node id. */
  id: string;
  /** A stream (a Station, Track or File), or an Audio input's live capture. */
  kind: "station" | "input";
  channelId: string;
  radio: Radio;
  isPlaying: boolean;
  isLoading: boolean;
  isMuted: boolean;
  volume: number;
  error: string | null;
};

const LANE_CHANNEL_PREFIX = "n:";

function useNodeSessionRecord(): PlaybackSessionRecord | undefined {
  return usePlaybackSessionSelector("node", (session) => session);
}

/**
 * Source summaries and playback actions, without graph or master subscriptions.
 */
export function useNodeSources() {
  const playback = getNodePlayback();
  const channels = usePlaybackSessionSelector("node", (session) =>
    (session?.channels ?? []).map((channel) => ({
      id: channel.id,
      muted: channel.muted,
      radio: channel.radio,
      volume: channel.volume,
    }))
  );

  // Only rendered source fields participate in equality, so meter ticks and
  // runtime updates outside this session leave the whole Node view alone.
  const sources: NodeSourceState[] = useStore(
    playbackRuntimeStore,
    (state) =>
      channels
        .filter(
          (channel): channel is typeof channel & { radio: Radio } =>
            Boolean(channel.radio) && channel.id.startsWith(LANE_CHANNEL_PREFIX)
        )
        .map((channel) => {
          const runtime = state.channels[channel.id];
          return {
            channelId: channel.id,
            error: runtime?.error?.message ?? null,
            id: channel.id.slice(LANE_CHANNEL_PREFIX.length),
            isLoading: runtime?.isLoading ?? false,
            isMuted: channel.muted || channel.volume === 0,
            isPlaying: runtime?.isPlaying ?? false,
            kind: isDeviceInputMetadata(channel.radio.platformMetadata)
              ? ("input" as const)
              : ("station" as const),
            radio: channel.radio,
            volume: channel.volume,
          };
        }),
    (previous, next) =>
      previous.length === next.length &&
      previous.every((source, index) => shallow(source, next[index]))
  );

  return {
    pauseAll: () => playback.pauseAll(),
    playAll: () => playback.playAll(),
    playingCount: sources.filter((source) => source.isPlaying).length,
    setVolume: (nodeId: string, volume: number) =>
      playback.setVolume(nodeId, volume),
    sources,
    toggleMute: (nodeId: string) => playback.toggleMute(nodeId),
    togglePlayPause: (nodeId: string) => {
      const source = sources.find((entry) => entry.id === nodeId);
      return playback.setPlaying(nodeId, !(source?.isPlaying ?? false));
    },
  };
}

export function useNodeMaster() {
  const masterVolume = usePlaybackSessionSelector(
    "node",
    (session) => session?.masterVolume ?? 1
  );
  const channelIds = usePlaybackSessionSelector("node", (session) =>
    (session?.channels ?? [])
      .filter(
        (channel) => channel.radio && channel.id.startsWith(LANE_CHANNEL_PREFIX)
      )
      .map((channel) => channel.id)
  );
  const playingCount = useStore(
    playbackRuntimeStore,
    (state) => channelIds.filter((id) => state.channels[id]?.isPlaying).length
  );
  const playback = getNodePlayback();
  return {
    masterMuted: masterVolume === 0,
    masterVolume,
    playingCount,
    setMasterVolume: (volume: number) => playback.setMasterVolume(volume),
    toggleMasterMute: () => playback.toggleMasterMute(),
  };
}

export function useNodeSessionGraph() {
  return usePlaybackSessionSelector(
    "node",
    (session) => session?.graph ?? null
  );
}

export function useNodeSession() {
  const session = useNodeSessionRecord();
  const sources = useNodeSources();
  return {
    ...sources,
    ...useNodeMaster(),
    graph: session?.graph ?? null,
    session,
  };
}
