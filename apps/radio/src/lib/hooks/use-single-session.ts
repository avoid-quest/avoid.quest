import { eq, useLiveQuery } from "@tanstack/react-db";
import { useCallback, useMemo, useState } from "react";
import type { Radio } from "@/lib/audio";
import {
  type PlaybackSessionRecord,
  playbackSessionsCollection,
  SINGLE_ACTIVE_CHANNEL_ID,
  SINGLE_STANDBY_CHANNEL_ID,
} from "@/lib/collections/playback-sessions";
import {
  selectSinglePlaybackRadio,
  setSingleChannelVolume,
  setSinglePlaybackState,
} from "@/lib/playback-actions";
import { usePlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";

function useSingleSessionRecord(): PlaybackSessionRecord | undefined {
  const result = useLiveQuery((q) =>
    q
      .from({ session: playbackSessionsCollection })
      .where(({ session }) => eq(session.id, "single"))
  );
  return result.data?.[0] as PlaybackSessionRecord | undefined;
}

export function useSingleSession(transitionDuration: number) {
  const session = useSingleSessionRecord();
  const activeChannelId = session?.activeChannelId;
  const activeChannel = session?.channels.find(
    (channel) => channel.id === activeChannelId
  );
  const standbyChannel = session?.channels.find(
    (channel) =>
      channel.id ===
      (activeChannelId === SINGLE_ACTIVE_CHANNEL_ID
        ? SINGLE_STANDBY_CHANNEL_ID
        : SINGLE_ACTIVE_CHANNEL_ID)
  );
  const activeRuntime = usePlaybackChannelRuntime(
    activeChannelId ?? "__none__"
  );
  const standbyRuntime = usePlaybackChannelRuntime(
    standbyChannel?.id ?? "__none__"
  );
  const [isCrossfading, setIsCrossfading] = useState(false);

  const currentRadio = activeChannel?.radio ?? null;
  const volume = activeChannel?.volume ?? 1;
  const error =
    activeRuntime.error?.message ?? standbyRuntime.error?.message ?? null;

  const selectRadio = useCallback(
    async (radio: Radio) => {
      const shouldCrossfade =
        !!currentRadio &&
        activeRuntime.isPlaying &&
        radio.streamUrl !== currentRadio.streamUrl;
      if (shouldCrossfade) {
        setIsCrossfading(true);
      }
      try {
        await selectSinglePlaybackRadio(radio, transitionDuration);
      } finally {
        if (shouldCrossfade) {
          setIsCrossfading(false);
        }
      }
    },
    [activeRuntime.isPlaying, currentRadio, transitionDuration]
  );

  const togglePlayPause = useCallback(async () => {
    await setSinglePlaybackState(!activeRuntime.isPlaying);
  }, [activeRuntime.isPlaying]);

  const play = useCallback(async () => {
    await setSinglePlaybackState(true);
  }, []);

  const pause = useCallback(async () => {
    await setSinglePlaybackState(false);
  }, []);

  const stop = pause;

  const setVolume = useCallback(
    (nextVolume: number) => {
      if (!activeChannelId) {
        return;
      }
      setSingleChannelVolume(activeChannelId, nextVolume);
    },
    [activeChannelId]
  );

  return useMemo(
    () => ({
      session,
      currentRadio,
      isPlaying: activeRuntime.isPlaying,
      isLoading: activeRuntime.isLoading,
      isCrossfading,
      error,
      volume,
      selectRadio,
      togglePlayPause,
      setVolume,
      play,
      pause,
      stop,
    }),
    [
      activeRuntime.isLoading,
      activeRuntime.isPlaying,
      currentRadio,
      error,
      isCrossfading,
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
