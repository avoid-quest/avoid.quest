import { eq, useLiveQuery } from "@tanstack/react-db";
import { useCallback, useMemo, useState } from "react";
import type { Radio } from "@/lib/audio";
import {
  type PlaybackSessionRecord,
  playbackSessionsCollection,
  SINGLE_ACTIVE_CHANNEL_ID,
  SINGLE_STANDBY_CHANNEL_ID,
} from "@/lib/collections/playback-sessions";
import { toRuntimeAudioError } from "@/lib/playback-action-errors";
import {
  selectSinglePlaybackRadio,
  setSingleChannelVolume,
  setSinglePlaybackState,
} from "@/lib/playback-actions";
import {
  setPlaybackChannelRuntime,
  usePlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";

function clearSingleSessionErrors(): void {
  for (const channelId of [
    SINGLE_ACTIVE_CHANNEL_ID,
    SINGLE_STANDBY_CHANNEL_ID,
  ]) {
    setPlaybackChannelRuntime(channelId, () => ({ error: null }));
  }
}

function setSingleSessionError(
  channelId: string,
  error: unknown,
  radio?: Radio
): void {
  setPlaybackChannelRuntime(channelId, () => ({
    isLoading: false,
    error: toRuntimeAudioError(error, "PLAY_ERROR", radio),
  }));
}

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
      const errorChannelId = activeChannelId ?? SINGLE_ACTIVE_CHANNEL_ID;
      if (shouldCrossfade) {
        setIsCrossfading(true);
      }
      try {
        clearSingleSessionErrors();
        await selectSinglePlaybackRadio(radio, transitionDuration);
      } catch (error) {
        setSingleSessionError(errorChannelId, error, radio);
      } finally {
        if (shouldCrossfade) {
          setIsCrossfading(false);
        }
      }
    },
    [activeChannelId, activeRuntime.isPlaying, currentRadio, transitionDuration]
  );

  const togglePlayPause = useCallback(async () => {
    try {
      clearSingleSessionErrors();
      await setSinglePlaybackState(!activeRuntime.isPlaying);
    } catch (error) {
      setSingleSessionError(
        activeChannelId ?? SINGLE_ACTIVE_CHANNEL_ID,
        error,
        currentRadio ?? undefined
      );
    }
  }, [activeChannelId, activeRuntime.isPlaying, currentRadio]);

  const play = useCallback(async () => {
    try {
      clearSingleSessionErrors();
      await setSinglePlaybackState(true);
    } catch (error) {
      setSingleSessionError(
        activeChannelId ?? SINGLE_ACTIVE_CHANNEL_ID,
        error,
        currentRadio ?? undefined
      );
    }
  }, [activeChannelId, currentRadio]);

  const pause = useCallback(async () => {
    try {
      clearSingleSessionErrors();
      await setSinglePlaybackState(false);
    } catch (error) {
      setSingleSessionError(
        activeChannelId ?? SINGLE_ACTIVE_CHANNEL_ID,
        error,
        currentRadio ?? undefined
      );
    }
  }, [activeChannelId, currentRadio]);

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
