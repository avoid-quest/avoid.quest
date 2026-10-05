import { eq, useLiveQuery } from "@tanstack/react-db";
import { shallow, useStore } from "@tanstack/react-store";
import type { Radio } from "@/lib/audio";
import {
  type PlaybackSessionRecord,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { getNodePlayback } from "@/lib/node-playback";
import { isDeviceInputMetadata } from "@/lib/platform-types";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";

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
  const result = useLiveQuery((q) =>
    q
      .from({ session: playbackSessionsCollection })
      .where(({ session }) => eq(session.id, "node"))
  );
  return result.data?.[0] as PlaybackSessionRecord | undefined;
}

/**
 * The node session as persisted: its graph, its lanes (the derived channel
 * cache joined with runtime state) and the Speakers master, plus the
 * playback actions keyed by Station node id.
 */
export function useNodeSession() {
  const playback = getNodePlayback();
  const session = useNodeSessionRecord();
  const masterVolume = session?.masterVolume ?? 1;

  // Only rendered source fields participate in equality, so meter ticks and
  // runtime updates outside this session leave the whole Node view alone.
  const sources: NodeSourceState[] = useStore(
    playbackRuntimeStore,
    (state) =>
      (session?.channels ?? [])
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
    graph: session?.graph ?? null,
    masterMuted: masterVolume === 0,
    masterVolume,
    pauseAll: () => playback.pauseAll(),
    playAll: () => playback.playAll(),
    playingCount: sources.filter((source) => source.isPlaying).length,
    session,
    setMasterVolume: (volume: number) => playback.setMasterVolume(volume),
    setVolume: (nodeId: string, volume: number) =>
      playback.setVolume(nodeId, volume),
    sources,
    toggleMasterMute: () => playback.toggleMasterMute(),
    toggleMute: (nodeId: string) => playback.toggleMute(nodeId),
    togglePlayPause: (nodeId: string) => {
      const source = sources.find((entry) => entry.id === nodeId);
      return playback.setPlaying(nodeId, !(source?.isPlaying ?? false));
    },
  };
}
