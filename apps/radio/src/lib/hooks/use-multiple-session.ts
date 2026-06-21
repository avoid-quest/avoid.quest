import { eq, useLiveQuery } from "@tanstack/react-db";
import { useStore } from "@tanstack/react-store";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Radio } from "@/lib/audio";
import {
  type PlaybackSessionRecord,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { createManagedPlaybackSessionWorkflow } from "@/lib/playback-actions";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";

export type MultipleSessionPlayerState = {
  id: string;
  radio: Radio;
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  error: string | null;
};

const PLAY_ALL_CONCURRENCY = 3;

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;

  const workerCount = Math.min(limit, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (index < items.length) {
        const currentItem = items[index];
        index += 1;

        if (currentItem === undefined) {
          return;
        }

        await task(currentItem);
        await yieldToBrowser();
      }
    })
  );
}

function useMultipleSessionRecord(): PlaybackSessionRecord | undefined {
  const result = useLiveQuery((q) =>
    q
      .from({ session: playbackSessionsCollection })
      .where(({ session }) => eq(session.id, "multiple"))
  );
  return result.data?.[0] as PlaybackSessionRecord | undefined;
}

function clearMultipleChannelError(channelId: string): void {
  createManagedPlaybackSessionWorkflow("multiple").clearPlaybackErrors([
    channelId,
  ]);
}

function setMultipleChannelError(
  channelId: string,
  error: unknown,
  radio?: Radio
): void {
  createManagedPlaybackSessionWorkflow("multiple").setPlaybackError(
    channelId,
    error,
    radio
  );
}

export function useMultipleSession() {
  const session = useMultipleSessionRecord();
  const lastGlobalVolumeRef = useRef(session?.masterVolume ?? 1);
  const runtimes = useStore(playbackRuntimeStore, (state) => state.channels);
  const globalVolume = session?.masterVolume ?? 1;
  const globalMuted = globalVolume === 0;

  useEffect(() => {
    if (globalVolume > 0) {
      lastGlobalVolumeRef.current = globalVolume;
    }
  }, [globalVolume]);

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
    createManagedPlaybackSessionWorkflow("multiple").syncChannels(radios);
  }, []);

  const addRadio = useCallback(async (radio: Radio, autoPlay = false) => {
    const channel =
      createManagedPlaybackSessionWorkflow("multiple").addChannel(radio);
    if (autoPlay) {
      try {
        clearMultipleChannelError(channel.id);
        await createManagedPlaybackSessionWorkflow("multiple").setPlaying(
          true,
          channel.id
        );
      } catch (error) {
        setMultipleChannelError(channel.id, error, radio);
      }
    }
    return channel.id;
  }, []);

  const removeRadio = useCallback((channelId: string) => {
    createManagedPlaybackSessionWorkflow("multiple").removeChannel(channelId);
  }, []);

  const togglePlayPause = useCallback(
    async (channelId: string) => {
      const player = players.find((entry) => entry.id === channelId);
      try {
        clearMultipleChannelError(channelId);
        await createManagedPlaybackSessionWorkflow("multiple").setPlaying(
          !(player?.isPlaying ?? false),
          channelId
        );
      } catch (error) {
        setMultipleChannelError(channelId, error, player?.radio);
      }
    },
    [players]
  );

  const setVolume = useCallback((channelId: string, volume: number) => {
    createManagedPlaybackSessionWorkflow("multiple").setChannelVolume(
      channelId,
      volume
    );
  }, []);

  const setGlobalVolume = useCallback((volume: number) => {
    if (volume > 0) {
      lastGlobalVolumeRef.current = volume;
    }
    createManagedPlaybackSessionWorkflow("multiple").setMasterVolume(volume);
  }, []);

  const toggleGlobalMute = useCallback(() => {
    if (globalMuted) {
      createManagedPlaybackSessionWorkflow("multiple").setMasterVolume(
        lastGlobalVolumeRef.current
      );
      return;
    }
    lastGlobalVolumeRef.current = globalVolume || lastGlobalVolumeRef.current;
    createManagedPlaybackSessionWorkflow("multiple").setMasterVolume(0);
  }, [globalMuted, globalVolume]);

  const playAll = useCallback(async () => {
    await runWithConcurrency(
      players.filter((player) => !player.isPlaying),
      PLAY_ALL_CONCURRENCY,
      async (player) => {
        try {
          clearMultipleChannelError(player.id);
          await createManagedPlaybackSessionWorkflow("multiple").setPlaying(
            true,
            player.id
          );
        } catch (error) {
          setMultipleChannelError(player.id, error, player.radio);
        }
      }
    );
  }, [players]);

  const pauseAll = useCallback(() => {
    createManagedPlaybackSessionWorkflow("multiple").pauseAll();
  }, []);

  return {
    session,
    players,
    globalVolume,
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
