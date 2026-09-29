import { eq, useLiveQuery } from "@tanstack/react-db";
import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import {
  type PlaybackSessionRecord,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { useAllRadios } from "@/lib/hooks/use-radios";
import { useSessionRadios } from "@/lib/hooks/use-session-radios";
import {
  getSinglePlayback,
  type SingleSelectionFailure,
} from "@/lib/single-playback";
import { findLiveStation } from "@/lib/stations/external-station-workflow";
import { usePlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";

function useSingleSessionRecord(): PlaybackSessionRecord | undefined {
  const result = useLiveQuery((q) =>
    q
      .from({ session: playbackSessionsCollection })
      .where(({ session }) => eq(session.id, "single"))
  );
  return result.data?.[0] as PlaybackSessionRecord | undefined;
}

/** A switch that failed while the previous Station resumed is not shown inline. */
function notifySwitchFailed(failure: SingleSelectionFailure) {
  toast.error(`Couldn't play "${failure.station.name}"`, {
    description: failure.message,
  });
}

export function useSingleSession() {
  const playback = getSinglePlayback();
  const session = useSingleSessionRecord();
  const savedRadios = useAllRadios();
  const sessionRadios = useSessionRadios((state) => state.radios);
  const activeChannelId = session?.activeChannelId;
  const activeChannel = session?.channels.find(
    (channel) => channel.id === activeChannelId
  );
  const activeRuntime = usePlaybackChannelRuntime(
    activeChannelId ?? "__none__"
  );

  // The session stores a copy of the Station. Show its current record so a
  // rename, Hide or Save shows up, and notice when the Station is gone.
  const storedRadio = activeChannel?.radio ?? null;
  const liveRadio =
    storedRadio && savedRadios.isReady
      ? (findLiveStation(
          [...sessionRadios, ...(savedRadios.data ?? [])],
          storedRadio
        ) ?? null)
      : null;
  const currentRadio = liveRadio ?? storedRadio;
  const volume = activeChannel?.volume ?? 1;
  const isMuted = Boolean(activeChannel?.muted) || volume <= 0;
  const error = activeRuntime.error?.message ?? null;

  useEffect(() => {
    if (!(storedRadio && savedRadios.isReady)) {
      return;
    }
    if (liveRadio) {
      // Saving a Session station stores it under a new id.
      playback.rebindStation(liveRadio);
      return;
    }
    // Deleted or removed: stop it so another Station can be selected.
    playback.releaseStation(storedRadio).catch((releaseError: unknown) => {
      console.error(
        "[single] Failed to release a removed Station",
        releaseError
      );
    });
  }, [liveRadio, playback, savedRadios.isReady, storedRadio]);

  const selectRadio = useCallback(
    (radio: Radio) =>
      playback.selectStation(radio, { onSwitchFailed: notifySwitchFailed }),
    [playback]
  );

  const playRadio = useCallback(
    (radio: Radio) =>
      playback.selectStation(radio, {
        onSwitchFailed: notifySwitchFailed,
        play: true,
      }),
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

  const toggleMute = useCallback(() => playback.toggleMute(), [playback]);

  return useMemo(
    () => ({
      currentRadio,
      error,
      isLoading: activeRuntime.isLoading,
      isMuted,
      isPlaying: activeRuntime.isPlaying,
      pause,
      play,
      playRadio,
      selectRadio,
      session,
      setVolume,
      stop,
      toggleMute,
      togglePlayPause,
      volume,
    }),
    [
      activeRuntime.isLoading,
      activeRuntime.isPlaying,
      currentRadio,
      error,
      isMuted,
      pause,
      play,
      playRadio,
      selectRadio,
      session,
      setVolume,
      stop,
      toggleMute,
      togglePlayPause,
      volume,
    ]
  );
}
