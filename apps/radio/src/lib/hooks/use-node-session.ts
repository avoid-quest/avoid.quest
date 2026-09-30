import { eq, useLiveQuery } from "@tanstack/react-db";
import { useStore } from "@tanstack/react-store";
import type { Radio } from "@/lib/audio";
import {
  type PlaybackSessionRecord,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { getNodePlayback } from "@/lib/node-playback";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";

/** A Station lane as the Speakers, Stage and Rack views render it. */
export type NodeSourceState = {
  /** The Station node id. */
  id: string;
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
  const runtimes = useStore(playbackRuntimeStore, (state) => state.channels);
  const masterVolume = session?.masterVolume ?? 1;

  const sources: NodeSourceState[] = (session?.channels ?? [])
    .filter(
      (channel): channel is typeof channel & { radio: Radio } =>
        Boolean(channel.radio) && channel.id.startsWith(LANE_CHANNEL_PREFIX)
    )
    .map((channel) => {
      const runtime = runtimes[channel.id];
      return {
        channelId: channel.id,
        error: runtime?.error?.message ?? null,
        id: channel.id.slice(LANE_CHANNEL_PREFIX.length),
        isLoading: runtime?.isLoading ?? false,
        isMuted: channel.muted || channel.volume === 0,
        isPlaying: runtime?.isPlaying ?? false,
        radio: channel.radio,
        volume: channel.volume,
      };
    });

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
