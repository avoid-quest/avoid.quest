import { eq, useLiveQuery } from "@tanstack/react-db";
import { useStore } from "@tanstack/react-store";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import {
  type PlaybackSessionRecord,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import {
  addMultiplePlaybackChannel,
  pauseAllMultipleChannels,
  playAllMultipleChannels,
  removeMultiplePlaybackChannel,
  setMultipleChannelPlaying,
  setMultipleChannelVolume,
  setMultipleSessionMasterVolume,
  syncMultiplePlaybackChannels,
} from "@/lib/playback-actions";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";

export type MultipleSessionPlayerState = {
  id: string;
  radio: Radio;
  isPlaying: boolean;
  isLoading: boolean;
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
  const session = useMultipleSessionRecord();
  const [globalMuted, setGlobalMuted] = useState(false);
  const lastGlobalVolumeRef = useRef(session?.masterVolume ?? 1);
  const runtimes = useStore(playbackRuntimeStore, (state) => state.channels);

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
          id: channel.id,
          radio: channel.radio,
          isPlaying: runtime?.isPlaying ?? false,
          isLoading: runtime?.isLoading ?? false,
          volume: channel.volume,
          error: runtime?.error?.message ?? null,
        };
      });
  }, [runtimes, session]);

  const syncRadios = useCallback((radios: Radio[]) => {
    syncMultiplePlaybackChannels(radios);
  }, []);

  const addRadio = useCallback(async (radio: Radio, autoPlay = false) => {
    const channel = addMultiplePlaybackChannel(radio);
    if (autoPlay) {
      await setMultipleChannelPlaying(channel.id, true);
    }
    return channel.id;
  }, []);

  const removeRadio = useCallback((channelId: string) => {
    removeMultiplePlaybackChannel(channelId);
  }, []);

  const togglePlayPause = useCallback(
    async (channelId: string) => {
      const player = players.find((entry) => entry.id === channelId);
      await setMultipleChannelPlaying(channelId, !(player?.isPlaying ?? false));
    },
    [players]
  );

  const setVolume = useCallback((channelId: string, volume: number) => {
    setMultipleChannelVolume(channelId, volume);
  }, []);

  const setGlobalVolume = useCallback((volume: number) => {
    if (volume > 0) {
      lastGlobalVolumeRef.current = volume;
      setGlobalMuted(false);
    }
    setMultipleSessionMasterVolume(volume);
  }, []);

  const toggleGlobalMute = useCallback(() => {
    if (globalMuted) {
      setMultipleSessionMasterVolume(lastGlobalVolumeRef.current);
      setGlobalMuted(false);
      return;
    }
    lastGlobalVolumeRef.current = session?.masterVolume ?? 1;
    setMultipleSessionMasterVolume(0);
    setGlobalMuted(true);
  }, [globalMuted, session?.masterVolume]);

  const playAll = useCallback(async () => {
    await playAllMultipleChannels();
  }, []);

  const pauseAll = useCallback(() => {
    pauseAllMultipleChannels();
  }, []);

  return {
    session,
    players,
    globalVolume: session?.masterVolume ?? 1,
    globalMuted,
    syncRadios,
    addRadio,
    removeRadio,
    togglePlayPause,
    setVolume,
    setGlobalVolume,
    toggleGlobalMute,
    playAll,
    pauseAll,
  };
}
