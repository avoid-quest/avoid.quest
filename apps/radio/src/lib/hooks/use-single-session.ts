import { eq, useLiveQuery } from "@tanstack/react-db";
import { useCallback, useMemo } from "react";
import type { Radio } from "@/lib/audio";
import {
  type PlaybackSessionRecord,
  playbackSessionsCollection,
  SINGLE_ACTIVE_CHANNEL_ID,
  SINGLE_STANDBY_CHANNEL_ID,
} from "@/lib/collections/playback-sessions";
import { createManagedPlaybackSessionWorkflow } from "@/lib/playback-actions";
import { usePlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";

function clearSingleSessionErrors(): void {
  createManagedPlaybackSessionWorkflow("single").clearPlaybackErrors([
    SINGLE_ACTIVE_CHANNEL_ID,
    SINGLE_STANDBY_CHANNEL_ID,
  ]);
}

function setSingleSessionError(
  channelId: string,
  error: unknown,
  radio?: Radio
): void {
  createManagedPlaybackSessionWorkflow("single").setPlaybackError(
    channelId,
    error,
    radio
  );
}

function useSingleSessionRecord(): PlaybackSessionRecord | undefined {
  const result = useLiveQuery((q) =>
    q
      .from({ session: playbackSessionsCollection })
      .where(({ session }) => eq(session.id, "single"))
  );
  return result.data?.[0] as PlaybackSessionRecord | undefined;
}

export function useSingleSession() {
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
    async (radio: Radio) => {
      const errorChannelId = activeChannelId ?? SINGLE_ACTIVE_CHANNEL_ID;
      try {
        clearSingleSessionErrors();
        await createManagedPlaybackSessionWorkflow("single").selectRadio(radio);
      } catch (error) {
        setSingleSessionError(errorChannelId, error, radio);
      }
    },
    [activeChannelId]
  );

  const togglePlayPause = useCallback(async () => {
    try {
      clearSingleSessionErrors();
      await createManagedPlaybackSessionWorkflow("single").setPlaying(
        !activeRuntime.isPlaying
      );
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
      await createManagedPlaybackSessionWorkflow("single").setPlaying(true);
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
      await createManagedPlaybackSessionWorkflow("single").setPlaying(false);
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
      createManagedPlaybackSessionWorkflow("single").setChannelVolume(
        activeChannelId,
        nextVolume
      );
    },
    [activeChannelId]
  );

  return useMemo(
    () => ({
      session,
      currentRadio,
      isPlaying: activeRuntime.isPlaying,
      isLoading: activeRuntime.isLoading,
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
