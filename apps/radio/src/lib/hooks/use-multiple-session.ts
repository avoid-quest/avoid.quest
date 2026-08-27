import { eq, useLiveQuery } from "@tanstack/react-db";
import { useStore } from "@tanstack/react-store";
import { useCallback, useMemo } from "react";
import type { Radio } from "@/lib/audio";
import {
  type PlaybackSessionRecord,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { getMultiplePlayback } from "@/lib/multiple-playback";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";

export type MultipleSessionPlayerState = {
  id: string;
  radio: Radio;
  isPlaying: boolean;
  isLoading: boolean;
  isMuted: boolean;
  volume: number;
  error: string | null;
};

function useMultipleSessionRecord(): PlaybackSessionRecord | undefined {
  const result = useLiveQuery((q) =>
    q
      .from({ session: playbackSessionsCollection })
      .where(({ session }) => eq(session.id, "multiple"))
  );
  return result.data?.[0] as PlaybackSessionRecord | undefined;
}

export function useMultipleSession() {
  const playback = getMultiplePlayback();
  const session = useMultipleSessionRecord();
  const runtimes = useStore(playbackRuntimeStore, (state) => state.channels);
  const globalVolume = session?.masterVolume ?? 1;
  const globalMuted = globalVolume === 0;

  const players = useMemo<MultipleSessionPlayerState[]>(() => {
    if (!session) {
      return [];
    }
    return session.channels
      .filter((channel): channel is typeof channel & { radio: Radio } =>
        Boolean(channel.radio)
      )
      .map((channel) => {
        const runtime = runtimes[channel.id];
        return {
          error: runtime?.error?.message ?? null,
          id: channel.id,
          isLoading: runtime?.isLoading ?? false,
          isMuted: channel.muted || channel.volume === 0,
          isPlaying: runtime?.isPlaying ?? false,
          radio: channel.radio,
          volume: channel.volume,
        };
      });
  }, [runtimes, session]);

  const syncRadios = useCallback(
    (saved: Radio[], sessionRadios: Radio[] = []) =>
      playback.synchronizeStations(saved, sessionRadios),
    [playback]
  );

  const addRadio = useCallback(
    (radio: Radio, autoPlay = false) => playback.addStation(radio, autoPlay),
    [playback]
  );

  const removeRadio = useCallback(
    (channelId: string) => playback.removeChannel(channelId),
    [playback]
  );

  const togglePlayPause = useCallback(
    async (channelId: string) => {
      const player = players.find((entry) => entry.id === channelId);
      await playback.setPlaying(channelId, !(player?.isPlaying ?? false));
    },
    [playback, players]
  );

  const setVolume = useCallback(
    (channelId: string, volume: number) =>
      playback.setVolume(channelId, volume),
    [playback]
  );

  const toggleMute = useCallback(
    (channelId: string) => playback.toggleMute(channelId),
    [playback]
  );

  const setGlobalVolume = useCallback(
    (volume: number) => playback.setMasterVolume(volume),
    [playback]
  );

  const toggleGlobalMute = useCallback(
    () => playback.toggleMasterMute(),
    [playback]
  );

  const playAll = useCallback(() => playback.playAll(), [playback]);

  const pauseAll = useCallback(() => playback.pauseAll(), [playback]);

  return {
    addRadio,
    globalMuted,
    globalVolume,
    pauseAll,
    playAll,
    players,
    removeRadio,
    session,
    setGlobalVolume,
    setVolume,
    syncRadios,
    toggleGlobalMute,
    toggleMute,
    togglePlayPause,
  };
}
