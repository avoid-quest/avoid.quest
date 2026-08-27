import { eq, useLiveQuery } from "@tanstack/react-db";
import { useCallback, useMemo } from "react";
import type { Radio } from "@/lib/audio";
import {
  type PlaybackSessionRecord,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { getSinglePlayback } from "@/lib/single-playback";
import { usePlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";

function useSingleSessionRecord(): PlaybackSessionRecord | undefined {
  const result = useLiveQuery((q) =>
    q
      .from({ session: playbackSessionsCollection })
      .where(({ session }) => eq(session.id, "single"))
  );
  return result.data?.[0] as PlaybackSessionRecord | undefined;
}

export function useSingleSession() {
  const playback = getSinglePlayback();
  const session = useSingleSessionRecord();
  const activeChannelId = session?.activeChannelId;
  const activeChannel = session?.channels.find(
    (channel) => channel.id === activeChannelId
  );
  const activeRuntime = usePlaybackChannelRuntime(
    activeChannelId ?? "__none__"
  );

  const currentRadio = activeChannel?.radio ?? null;
  const volume = activeChannel?.volume ?? 1;
  const error = activeRuntime.error?.message ?? null;

  const selectRadio = useCallback(
    (radio: Radio) => playback.selectStation(radio),
    [playback]
  );

  const togglePlayPause = useCallback(
    () => playback.setPlaying(!activeRuntime.isPlaying),
    [activeRuntime.isPlaying, playback]
  );

  const play = useCallback(() => playback.setPlaying(true), [playback]);

  const pause = useCallback(() => playback.setPlaying(false), [playback]);

  const stop = pause;

  const setVolume = useCallback(
    (nextVolume: number) => playback.setVolume(nextVolume),
    [playback]
  );

  return useMemo(
    () => ({
      currentRadio,
      error,
      isLoading: activeRuntime.isLoading,
      isPlaying: activeRuntime.isPlaying,
      pause,
      play,
      selectRadio,
      session,
      setVolume,
      stop,
      togglePlayPause,
      volume,
    }),
    [
      activeRuntime.isLoading,
      activeRuntime.isPlaying,
      currentRadio,
      error,
      pause,
      play,
      selectRadio,
      session,
      setVolume,
      stop,
      togglePlayPause,
      volume,
    ]
  );
}
