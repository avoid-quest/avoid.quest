import PQueue from "p-queue";
import { fadeOut, type Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  getPlaybackChannel,
  getPlaybackSession,
  SINGLE_ACTIVE_CHANNEL_ID,
  SINGLE_STANDBY_CHANNEL_ID,
  setPlaybackSessionActiveChannel,
  upsertPlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { shouldUseNativeSinglePlayback } from "@/lib/collections/settings";
import { validateRadioForMode } from "@/lib/external-url/utils";
import {
  getPlaybackChannelRuntime,
  resetPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import {
  clearManagedPlaybackErrors,
  getReadyManagedPlaybackSession,
  playManagedSound,
  restoreManagedChannels,
  setManagedChannelPlaying,
  setManagedPlaybackError,
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
  createManagedSound,
  isSameRadio,
} from "./playback-actions-shared.js";

export type SinglePlayback = {
  activate: () => Promise<void>;
  deactivate: () => Promise<void>;
  reconcileRouting: () => Promise<void>;
  selectStation: (station: Radio) => Promise<void>;
  setPlaying: (playing: boolean) => Promise<void>;
  setVolume: (volume: number) => void;
};

type FadeOutSound = (
  soundId: string,
  durationMs: number,
  stopAfter: boolean
) => Promise<void>;

type GetSinglePlaybackOptions = {
  ctx?: PlaybackActionContext;
  fadeOutDurationMs?: number;
  fadeOutSound?: FadeOutSound;
};

type SelectionState = {
  playbackIntent: boolean;
  rollbackSoundId: string | null;
};

const DEFAULT_FADE_OUT_DURATION_MS = 150;
const SINGLE_CHANNEL_IDS = [
  SINGLE_ACTIVE_CHANNEL_ID,
  SINGLE_STANDBY_CHANNEL_ID,
] as const;
const instances = new WeakMap<PlaybackActionContext, SinglePlayback>();

function getSingleOwnedChannelIds(): string[] {
  return Array.from(
    new Set([
      ...SINGLE_CHANNEL_IDS,
      ...(getPlaybackSession("single")?.channels.map((channel) => channel.id) ??
        []),
    ])
  );
}

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("Selection superseded", "AbortError")
  );
}

function waitForAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      }
    );
  });
}

class SelectionCoordinator {
  private active: AbortController | null = null;
  private activeSelection: SelectionState | null = null;
  private readonly queue = new PQueue({ concurrency: 1 });
  private deactivationCount = 0;

  runSelection(
    playbackIntent: boolean,
    rollbackSoundId: string | null,
    task: (signal: AbortSignal, state: SelectionState) => Promise<void>
  ): Promise<void> {
    const state = this.activeSelection ?? { playbackIntent, rollbackSoundId };
    return this.enqueue((signal) => task(signal, state), state);
  }

  updatePlaybackIntent(playbackIntent: boolean): void {
    if (this.activeSelection) {
      this.activeSelection.playbackIntent = playbackIntent;
    }
  }

  async runAfterCurrent(task: () => Promise<void>): Promise<void> {
    if (this.deactivationCount > 0) {
      return;
    }
    await this.queue.add(async () => {
      if (this.deactivationCount === 0) {
        await task();
      }
    });
  }

  async cancelAndRun(task: () => Promise<void>): Promise<void> {
    this.deactivationCount += 1;
    this.active?.abort();
    try {
      await this.queue.add(task);
    } finally {
      this.deactivationCount -= 1;
    }
  }

  private enqueue(
    task: (signal: AbortSignal) => Promise<void>,
    selection: SelectionState | null
  ): Promise<void> {
    if (this.deactivationCount > 0) {
      return Promise.resolve();
    }

    this.active?.abort();
    const controller = new AbortController();
    this.active = controller;
    this.activeSelection = selection;

    return this.queue
      .add(() => task(controller.signal), { signal: controller.signal })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          throw error;
        }
      })
      .finally(() => {
        if (this.active === controller) {
          this.active = null;
          this.activeSelection = null;
        }
      });
  }
}

function getSelectionChannel() {
  const session = getPlaybackSession("single");
  if (!session) {
    return null;
  }
  const channelId = session.activeChannelId ?? SINGLE_ACTIVE_CHANNEL_ID;
  return (
    getPlaybackChannel("single", channelId) ??
    createDefaultChannel(channelId, "single-primary", 0)
  );
}

async function selectStation(
  station: Radio,
  selection: SelectionState,
  ctx: PlaybackActionContext,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) {
    throw abortReason(signal);
  }
  validateRadioForMode(station, "single");

  const channel = getSelectionChannel();
  if (!channel || isSameRadio(channel.radio, station)) {
    return;
  }

  cleanupManagedChannel(channel.id, ctx);
  upsertPlaybackChannel("single", { ...channel, radio: station });
  setPlaybackSessionActiveChannel("single", channel.id);
  let playbackAttempted = false;
  try {
    const soundId = createManagedSound(
      "single",
      channel.id,
      station,
      undefined,
      ctx
    );
    if (!selection.playbackIntent) {
      return;
    }
    playbackAttempted = true;
    await waitForAbortable(
      playManagedSound("single", soundId, channel.volume, ctx),
      signal
    );
    if (signal.aborted) {
      throw abortReason(signal);
    }
  } catch (error) {
    cleanupManagedChannel(channel.id, ctx);
    upsertPlaybackChannel("single", channel);
    if (signal.aborted) {
      throw abortReason(signal);
    }
    if (channel.radio && selection.rollbackSoundId) {
      const restoredSoundId = createManagedSound(
        "single",
        channel.id,
        channel.radio,
        selection.rollbackSoundId,
        ctx
      );
      if (selection.playbackIntent) {
        await playManagedSound("single", restoredSoundId, channel.volume, ctx);
      }
    }
    if (!selection.playbackIntent && playbackAttempted) {
      return;
    }
    throw reportPlaybackActionError(ctx.reportError, {
      cause: error,
      channelId: channel.id,
      code: "PLAY_ERROR",
      mode: "single",
      radio: station,
    });
  }
}

async function reconcileRouting(ctx: PlaybackActionContext): Promise<void> {
  const channel = getSelectionChannel();
  if (!channel?.radio) {
    return;
  }
  const runtime = getPlaybackChannelRuntime(channel.id);
  const outputMode = shouldUseNativeSinglePlayback() ? "native" : "audio-graph";
  if (
    !runtime.soundId ||
    ctx.channels.getOutputMode?.(channel.id) === outputMode
  ) {
    return;
  }

  const { isPlaying: shouldResume, soundId } = runtime;
  cleanupManagedChannel(channel.id, ctx);
  createManagedSound("single", channel.id, channel.radio, soundId, ctx);
  if (!shouldResume) {
    return;
  }
  try {
    await playManagedSound("single", soundId, channel.volume, ctx);
  } catch (error) {
    throw reportPlaybackActionError(ctx.reportError, {
      cause: error,
      channelId: channel.id,
      code: "PLAY_ERROR",
      mode: "single",
      radio: channel.radio,
    });
  }
}

function createSinglePlayback(
  ctx: PlaybackActionContext,
  fadeOutSound: FadeOutSound,
  fadeOutDurationMs: number
): SinglePlayback {
  const selection = new SelectionCoordinator();
  let playingRevision = 0;

  return {
    async activate() {
      const session = await getReadyManagedPlaybackSession("single");
      const activeChannel = session.channels.find(
        (channel) => channel.id === session.activeChannelId
      );
      restoreManagedChannels(
        "single",
        activeChannel ? [activeChannel] : [],
        ctx
      );
      applySessionMasterVolume("single", ctx);
    },
    async deactivate() {
      playingRevision += 1;
      await selection.cancelAndRun(async () => {
        const channelIds = getSingleOwnedChannelIds();
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
        cleanupOrphanedSounds(soundIds, ctx, "single");
      });
    },
    async reconcileRouting() {
      try {
        await selection.runAfterCurrent(() => reconcileRouting(ctx));
      } catch (error) {
        setManagedPlaybackError(
          getSelectionChannel()?.id ?? SINGLE_ACTIVE_CHANNEL_ID,
          error
        );
        throw error;
      }
    },
    async selectStation(station) {
      const channel = getSelectionChannel();
      if (channel && isSameRadio(channel.radio, station)) {
        return;
      }
      playingRevision += 1;
      clearManagedPlaybackErrors(SINGLE_CHANNEL_IDS);
      const runtime = channel ? getPlaybackChannelRuntime(channel.id) : null;
      try {
        await selection.runSelection(
          runtime?.isPlaying ?? false,
          runtime?.soundId ?? null,
          (signal, state) => selectStation(station, state, ctx, signal)
        );
      } catch (error) {
        setManagedPlaybackError(
          channel?.id ?? SINGLE_ACTIVE_CHANNEL_ID,
          error,
          station
        );
      }
    },
    async setPlaying(playing) {
      playingRevision += 1;
      const revision = playingRevision;
      clearManagedPlaybackErrors(SINGLE_CHANNEL_IDS);
      selection.updatePlaybackIntent(playing);
      const channel = getSelectionChannel();
      try {
        await setManagedChannelPlaying(
          "single",
          channel ?? undefined,
          playing,
          ctx
        );
      } catch (error) {
        if (revision === playingRevision) {
          const reportedError = reportPlaybackActionError(ctx.reportError, {
            cause: error,
            channelId: channel?.id ?? SINGLE_ACTIVE_CHANNEL_ID,
            code: "PLAY_ERROR",
            mode: "single",
            radio: channel?.radio ?? undefined,
          });
          setManagedPlaybackError(
            channel?.id ?? SINGLE_ACTIVE_CHANNEL_ID,
            reportedError,
            channel?.radio ?? undefined
          );
        }
      }
    },
    setVolume(volume) {
      ctx.channels.setVolume(
        "single",
        getSelectionChannel()?.id ?? SINGLE_ACTIVE_CHANNEL_ID,
        volume
      );
    },
  };
}

export function getSinglePlayback({
  ctx = getDefaultPlaybackActionContext(),
  fadeOutDurationMs = DEFAULT_FADE_OUT_DURATION_MS,
  fadeOutSound = fadeOut,
}: GetSinglePlaybackOptions = {}): SinglePlayback {
  const existing = instances.get(ctx);
  if (existing) {
    return existing;
  }
  const playback = createSinglePlayback(ctx, fadeOutSound, fadeOutDurationMs);
  instances.set(ctx, playback);
  return playback;
}
