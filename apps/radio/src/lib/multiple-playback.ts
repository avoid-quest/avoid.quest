import { fadeOut, type Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  getMultipleChannelId,
  getPlaybackChannel,
  getPlaybackSession,
  removePlaybackChannel,
  replacePlaybackChannels,
  upsertPlaybackChannel,
} from "@/lib/collections/playback-sessions";
import {
  getPlaybackChannelRuntime,
  getPlaybackRuntimeChannelIds,
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import {
  clearManagedPlaybackErrors,
  getReadyManagedPlaybackSession,
  restoreManagedChannels,
  setManagedChannelPlaying,
  setManagedPlaybackError,
  setManagedSessionMasterVolume,
} from "./managed-playback-internals.js";
import {
  cleanupOrphanedSounds,
  getRuntimeSoundIds,
} from "./mode-lifecycle-cleanup.js";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "./playback-action-context.js";
import {
  applySessionMasterVolume,
  cleanupManagedChannel,
} from "./playback-actions-shared.js";

export type MultiplePlayback = {
  activate: () => Promise<void>;
  addStation: (station: Radio, autoPlay?: boolean) => Promise<string>;
  deactivate: () => Promise<void>;
  pauseAll: () => void;
  playAll: () => Promise<void>;
  removeChannel: (channelId: string) => void;
  setMasterVolume: (volume: number) => void;
  setPlaying: (channelId: string, playing: boolean) => Promise<void>;
  setVolume: (channelId: string, volume: number) => void;
  synchronizeStations: (saved: Radio[], session: Radio[]) => void;
  toggleMasterMute: () => void;
  toggleMute: (channelId: string) => void;
};

type FadeOutSound = (
  soundId: string,
  durationMs: number,
  stopAfter: boolean
) => Promise<void>;

type GetMultiplePlaybackOptions = {
  ctx?: PlaybackActionContext;
  fadeOutDurationMs?: number;
  fadeOutSound?: FadeOutSound;
};

type PlayAllGeneration = {
  cancellation: "deactivate" | "pause" | null;
};

const DEFAULT_FADE_OUT_DURATION_MS = 150;
const PLAY_ALL_CONCURRENCY = 3;
const instances = new WeakMap<PlaybackActionContext, MultiplePlayback>();

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
  shouldContinue: () => boolean = () => true
): Promise<void> {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        if (!shouldContinue()) {
          return;
        }
        const item = items[index];
        index += 1;
        if (item === undefined) {
          return;
        }
        await task(item);
        if (!shouldContinue()) {
          return;
        }
        await yieldToBrowser();
      }
    })
  );
}

function synchronizeStations(
  saved: Radio[],
  session: Radio[],
  ctx: PlaybackActionContext
): void {
  const radios = [
    ...saved,
    ...session.filter(
      (sessionStation) =>
        !saved.some((station) => station.id === sessionStation.id)
    ),
  ];
  const existingChannels = getPlaybackSession("multiple")?.channels ?? [];
  const existingChannelsById = new Map(
    existingChannels.map((channel) => [channel.id, channel])
  );
  const nextChannelIds = new Set(radios.map(getMultipleChannelId));

  for (const channel of existingChannels) {
    if (!nextChannelIds.has(channel.id)) {
      cleanupManagedChannel(channel.id, ctx);
    }
  }

  replacePlaybackChannels(
    "multiple",
    radios.map((radio, order) => {
      const channelId = getMultipleChannelId(radio);
      return {
        ...(existingChannelsById.get(channelId) ??
          createDefaultChannel(channelId, "multiple", order)),
        id: channelId,
        role: "multiple" as const,
        radio,
        order,
      };
    })
  );
}

function addStationChannel(radio: Radio) {
  const channelId = getMultipleChannelId(radio);
  const existing = getPlaybackChannel("multiple", channelId);
  const order =
    existing?.order ?? getPlaybackSession("multiple")?.channels.length ?? 0;
  const channel = {
    ...(existing ?? createDefaultChannel(channelId, "multiple", order)),
    id: channelId,
    role: "multiple" as const,
    radio,
    order,
  };
  upsertPlaybackChannel("multiple", channel);
  return channel;
}

function createMultiplePlayback(
  ctx: PlaybackActionContext,
  fadeOutSound: FadeOutSound,
  fadeOutDurationMs: number
): MultiplePlayback {
  const initialSession = getPlaybackSession("multiple");
  const activePlayAllGenerations = new Set<PlayAllGeneration>();
  const unmutedVolumes = new Map<string, number>();
  for (const channel of initialSession?.channels ?? []) {
    if (channel.volume > 0) {
      unmutedVolumes.set(channel.id, channel.volume);
    }
  }
  let unmutedMasterVolume =
    initialSession && initialSession.masterVolume > 0
      ? initialSession.masterVolume
      : 1;

  const setVolume = (channelId: string, volume: number) => {
    if (volume > 0) {
      unmutedVolumes.set(channelId, volume);
    }
    ctx.channels.setVolume("multiple", channelId, volume);
  };

  const setMasterVolume = (volume: number) => {
    if (volume > 0) {
      unmutedMasterVolume = volume;
    }
    setManagedSessionMasterVolume("multiple", volume, ctx);
  };

  const setPlaying = async (channelId: string, playing: boolean) => {
    clearManagedPlaybackErrors([channelId]);
    const channel = getPlaybackChannel("multiple", channelId);
    try {
      await setManagedChannelPlaying("multiple", channel, playing, ctx);
    } catch (error) {
      setManagedPlaybackError(channelId, error, channel?.radio ?? undefined);
    }
  };

  const pauseChannel = (channelId: string) => {
    const runtime = getPlaybackChannelRuntime(channelId);
    if (runtime.soundId) {
      ctx.audio.pauseSound(runtime.soundId);
    }
    if (
      runtime.soundId ||
      runtime.isPlaying ||
      runtime.isLoading ||
      runtime.isBuffering
    ) {
      setPlaybackChannelRuntime(channelId, () => ({
        isBuffering: false,
        isLoading: false,
        isPlaying: false,
      }));
    }
  };

  const pauseAll = () => {
    for (const generation of activePlayAllGenerations) {
      if (generation.cancellation === null) {
        generation.cancellation = "pause";
      }
    }
    for (const channel of getPlaybackSession("multiple")?.channels ?? []) {
      pauseChannel(channel.id);
    }
  };

  return {
    async activate() {
      const session = await getReadyManagedPlaybackSession("multiple");
      restoreManagedChannels("multiple", session.channels, ctx);
      applySessionMasterVolume("multiple", ctx);
      if (session.masterVolume > 0) {
        unmutedMasterVolume = session.masterVolume;
      }
      for (const channel of session.channels) {
        if (channel.volume > 0) {
          unmutedVolumes.set(channel.id, channel.volume);
        }
      }
    },
    async addStation(station, autoPlay = false) {
      const channel = addStationChannel(station);
      if (autoPlay) {
        await setPlaying(channel.id, true);
      }
      return channel.id;
    },
    async deactivate() {
      for (const generation of activePlayAllGenerations) {
        generation.cancellation = "deactivate";
      }
      const channelIds = Array.from(
        new Set([
          ...(getPlaybackSession("multiple")?.channels.map(
            (channel) => channel.id
          ) ?? []),
          ...getPlaybackRuntimeChannelIds().filter((channelId) =>
            channelId.startsWith("multi:")
          ),
        ])
      );
      const soundIds = getRuntimeSoundIds(channelIds);
      await Promise.all(
        soundIds.map((soundId) =>
          fadeOutSound(soundId, fadeOutDurationMs, true)
        )
      );
      for (const channelId of channelIds) {
        cleanupManagedChannel(channelId, ctx);
        resetPlaybackChannelRuntime(channelId);
      }
      cleanupOrphanedSounds(soundIds, ctx, "multiple");
    },
    pauseAll,
    async playAll() {
      const generation: PlayAllGeneration = { cancellation: null };
      activePlayAllGenerations.add(generation);
      const channels = (getPlaybackSession("multiple")?.channels ?? []).filter(
        (channel) => !getPlaybackChannelRuntime(channel.id).isPlaying
      );
      try {
        await runWithConcurrency(
          channels,
          PLAY_ALL_CONCURRENCY,
          async (channel) => {
            await setPlaying(channel.id, true);
            if (generation.cancellation === null) {
              return;
            }
            if (generation.cancellation === "deactivate") {
              cleanupManagedChannel(channel.id, ctx);
              resetPlaybackChannelRuntime(channel.id);
            } else {
              pauseChannel(channel.id);
            }
          },
          () => generation.cancellation === null
        );
      } finally {
        activePlayAllGenerations.delete(generation);
      }
    },
    removeChannel(channelId) {
      cleanupManagedChannel(channelId, ctx);
      resetPlaybackChannelRuntime(channelId);
      unmutedVolumes.delete(channelId);
      removePlaybackChannel("multiple", channelId);
    },
    setMasterVolume,
    setPlaying,
    setVolume,
    synchronizeStations: (saved, session) =>
      synchronizeStations(saved, session, ctx),
    toggleMasterMute() {
      const volume = getPlaybackSession("multiple")?.masterVolume ?? 1;
      if (volume > 0) {
        unmutedMasterVolume = volume;
        setMasterVolume(0);
        return;
      }
      setMasterVolume(unmutedMasterVolume);
    },
    toggleMute(channelId) {
      const volume = getPlaybackChannel("multiple", channelId)?.volume ?? 1;
      if (volume > 0) {
        unmutedVolumes.set(channelId, volume);
        setVolume(channelId, 0);
        return;
      }
      setVolume(channelId, unmutedVolumes.get(channelId) ?? 1);
    },
  };
}

export function getMultiplePlayback({
  ctx = getDefaultPlaybackActionContext(),
  fadeOutDurationMs = DEFAULT_FADE_OUT_DURATION_MS,
  fadeOutSound = fadeOut,
}: GetMultiplePlaybackOptions = {}): MultiplePlayback {
  const existing = instances.get(ctx);
  if (existing) {
    return existing;
  }
  const playback = createMultiplePlayback(ctx, fadeOutSound, fadeOutDurationMs);
  instances.set(ctx, playback);
  return playback;
}
