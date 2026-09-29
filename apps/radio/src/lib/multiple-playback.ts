import { fadeOut, type Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  getMultipleChannelId,
  getPlaybackChannel,
  getPlaybackSession,
  type PlaybackChannelRecord,
  removePlaybackChannel,
  replacePlaybackChannels,
  upsertPlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { isSameStation } from "@/lib/stations/external-station-workflow";
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
import { reportPlaybackActionError } from "./playback-action-errors.js";
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

type PlaybackCancellation = "deactivate" | "pause" | "remove";

type PlayAllGeneration = { cancellation: PlaybackCancellation | null };

type ChannelStartOwnership = {
  cancellation: PlaybackCancellation | null;
  cancellationRevision: number | null;
  channelId: string;
  revision: number;
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
  const runNext = async (): Promise<void> => {
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
    return runNext();
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, runNext)
  );
}

type CarriedChannel = {
  from: PlaybackChannelRecord;
  wasPlaying: boolean;
};

function getSynchronizedRadios(saved: Radio[], session: Radio[]): Radio[] {
  return [
    ...saved,
    ...session.filter(
      (sessionStation) =>
        !saved.some((station) => station.id === sessionStation.id)
    ),
  ];
}

/**
 * Channels whose Station comes back under a new id in this synchronization,
 * e.g. a Session station that was just saved. Keyed by the new Channel id.
 */
function findCarriedChannels(
  radios: Radio[],
  existingChannels: readonly PlaybackChannelRecord[]
): Map<string, CarriedChannel> {
  const nextChannelIds = new Set(radios.map(getMultipleChannelId));
  const removedChannels = existingChannels.filter(
    (channel) => !nextChannelIds.has(channel.id)
  );
  const carried = new Map<string, CarriedChannel>();
  for (const radio of radios) {
    const channelId = getMultipleChannelId(radio);
    if (existingChannels.some((channel) => channel.id === channelId)) {
      continue;
    }
    const from = removedChannels.find(
      (channel) =>
        channel.radio &&
        isSameStation(channel.radio, radio) &&
        ![...carried.values()].some((entry) => entry.from === channel)
    );
    if (from) {
      const runtime = getPlaybackChannelRuntime(from.id);
      carried.set(channelId, {
        from,
        wasPlaying: runtime.isPlaying || runtime.isLoading,
      });
    }
  }
  return carried;
}

function synchronizeStations(
  radios: Radio[],
  carried: ReadonlyMap<string, CarriedChannel>,
  removeChannel: (channelId: string) => void
): void {
  const existingChannels = getPlaybackSession("multiple")?.channels ?? [];
  const existingChannelsById = new Map(
    existingChannels.map((channel) => [channel.id, channel])
  );
  const nextChannelIds = new Set(radios.map(getMultipleChannelId));

  for (const channel of existingChannels) {
    if (!nextChannelIds.has(channel.id)) {
      removeChannel(channel.id);
    }
  }

  replacePlaybackChannels(
    "multiple",
    radios.map((radio, order) => {
      const channelId = getMultipleChannelId(radio);
      return {
        ...(existingChannelsById.get(channelId) ??
          carried.get(channelId)?.from ??
          createDefaultChannel(channelId, "multiple", order)),
        id: channelId,
        order,
        radio,
        role: "multiple" as const,
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
    order,
    radio,
    role: "multiple" as const,
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
  const activeChannelStarts = new Set<ChannelStartOwnership>();
  const activePlayAllGenerations = new Set<PlayAllGeneration>();
  const channelStartRevisions = new Map<string, number>();
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
      if (getPlaybackChannel("multiple", channelId)?.muted) {
        ctx.channels.setMuted("multiple", channelId, false);
      }
    }
    ctx.channels.setVolume("multiple", channelId, volume);
  };

  const setMasterVolume = (volume: number) => {
    if (volume > 0) {
      unmutedMasterVolume = volume;
    }
    setManagedSessionMasterVolume("multiple", volume, ctx);
  };

  const advanceChannelRevision = (channelId: string) => {
    const revision = (channelStartRevisions.get(channelId) ?? 0) + 1;
    channelStartRevisions.set(channelId, revision);
    return revision;
  };

  const beginChannelStart = (channelId: string): ChannelStartOwnership => {
    const revision = advanceChannelRevision(channelId);
    const ownership = {
      cancellation: null,
      cancellationRevision: null,
      channelId,
      revision,
    };
    activeChannelStarts.add(ownership);
    return ownership;
  };

  const setChannelPlaying = async (
    channelId: string,
    playing: boolean,
    revision: number,
    shouldReportError = () => channelStartRevisions.get(channelId) === revision
  ) => {
    clearManagedPlaybackErrors([channelId]);
    const channel = getPlaybackChannel("multiple", channelId);
    try {
      await setManagedChannelPlaying("multiple", channel, playing, ctx);
    } catch (error) {
      if (shouldReportError()) {
        const reportedError = reportPlaybackActionError(ctx.reportError, {
          cause: error,
          channelId,
          code: "PLAY_ERROR",
          mode: "multiple",
          radio: channel?.radio ?? undefined,
        });
        setManagedPlaybackError(
          channelId,
          reportedError,
          channel?.radio ?? undefined
        );
      }
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

  const cancelChannelStarts = (
    cancellation: PlaybackCancellation,
    channelId?: string
  ) => {
    let cancelled = false;
    for (const ownership of activeChannelStarts) {
      if (channelId && ownership.channelId !== channelId) {
        continue;
      }
      if (
        cancellation === "pause" &&
        ownership.cancellation !== null &&
        ownership.cancellation !== "pause"
      ) {
        continue;
      }
      ownership.cancellation = cancellation;
      ownership.cancellationRevision =
        channelStartRevisions.get(ownership.channelId) ?? ownership.revision;
      cancelled = true;
    }
    return cancelled;
  };

  const startChannel = async (channelId: string) => {
    const ownership = beginChannelStart(channelId);
    try {
      await setChannelPlaying(
        channelId,
        true,
        ownership.revision,
        () =>
          ownership.cancellation === null &&
          channelStartRevisions.get(channelId) === ownership.revision
      );
    } finally {
      activeChannelStarts.delete(ownership);
      if (
        ownership.cancellation !== null &&
        channelStartRevisions.get(channelId) === ownership.cancellationRevision
      ) {
        if (ownership.cancellation === "pause") {
          pauseChannel(channelId);
        } else {
          cleanupManagedChannel(channelId, ctx);
          resetPlaybackChannelRuntime(channelId);
        }
      }
    }
  };

  const setPlaying = async (channelId: string, playing: boolean) => {
    if (playing) {
      await startChannel(channelId);
      return;
    }
    const cancelledStart = cancelChannelStarts("pause", channelId);
    const revision = cancelledStart
      ? (channelStartRevisions.get(channelId) ??
        advanceChannelRevision(channelId))
      : advanceChannelRevision(channelId);
    await setChannelPlaying(channelId, false, revision);
  };

  const pauseAll = () => {
    for (const generation of activePlayAllGenerations) {
      if (generation.cancellation === null) {
        generation.cancellation = "pause";
      }
    }
    cancelChannelStarts("pause");
    for (const channel of getPlaybackSession("multiple")?.channels ?? []) {
      pauseChannel(channel.id);
    }
  };

  const removeChannelMembership = (channelId: string) => {
    cancelChannelStarts("remove", channelId);
    cleanupManagedChannel(channelId, ctx);
    resetPlaybackChannelRuntime(channelId);
    unmutedVolumes.delete(channelId);
    removePlaybackChannel("multiple", channelId);
  };

  const getOwnedChannelIds = () =>
    Array.from(
      new Set([
        ...(getPlaybackSession("multiple")?.channels.map(
          (channel) => channel.id
        ) ?? []),
        ...getPlaybackRuntimeChannelIds().filter((channelId) =>
          channelId.startsWith("multi:")
        ),
      ])
    );

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
      cancelChannelStarts("deactivate");
      const initialChannelIds = getOwnedChannelIds();
      const initialSoundIds = getRuntimeSoundIds(initialChannelIds);
      await Promise.all(
        initialSoundIds.map((soundId) =>
          fadeOutSound(soundId, fadeOutDurationMs, true)
        )
      );
      for (const generation of activePlayAllGenerations) {
        generation.cancellation = "deactivate";
      }
      cancelChannelStarts("deactivate");
      const channelIds = Array.from(
        new Set([...initialChannelIds, ...getOwnedChannelIds()])
      );
      const soundIds = Array.from(
        new Set([...initialSoundIds, ...getRuntimeSoundIds(channelIds)])
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
            await startChannel(channel.id);
          },
          () => generation.cancellation === null
        );
      } finally {
        activePlayAllGenerations.delete(generation);
      }
    },
    removeChannel: removeChannelMembership,
    setMasterVolume,
    setPlaying,
    setVolume,
    synchronizeStations(saved, session) {
      const radios = getSynchronizedRadios(saved, session);
      const carried = findCarriedChannels(
        radios,
        getPlaybackSession("multiple")?.channels ?? []
      );
      for (const [channelId, { from }] of carried) {
        const unmutedVolume = unmutedVolumes.get(from.id);
        if (unmutedVolume !== undefined) {
          unmutedVolumes.set(channelId, unmutedVolume);
        }
      }
      synchronizeStations(radios, carried, removeChannelMembership);
      // The old Channel's sound is gone with its id; resume on the new one.
      for (const [channelId, { wasPlaying }] of carried) {
        if (wasPlaying) {
          startChannel(channelId).catch((error: unknown) => {
            console.warn("[MultiplePlayback] Could not resume Station", error);
          });
        }
      }
    },
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
      const channel = getPlaybackChannel("multiple", channelId);
      if (!channel) {
        return;
      }
      if (channel.muted) {
        if (channel.volume === 0) {
          setVolume(channelId, unmutedVolumes.get(channelId) ?? 1);
        } else {
          ctx.channels.setMuted("multiple", channelId, false);
          // The engine restores its own pre-mute gain, which is unset for a
          // sound created muted; re-apply the persisted Channel volume.
          ctx.channels.setVolume("multiple", channelId, channel.volume);
        }
        return;
      }
      if (channel.volume === 0) {
        setVolume(channelId, unmutedVolumes.get(channelId) ?? 1);
        return;
      }
      ctx.channels.setMuted("multiple", channelId, true);
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
