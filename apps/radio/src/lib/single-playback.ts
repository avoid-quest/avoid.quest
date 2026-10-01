import PQueue from "p-queue";
import { fadeOut, type Radio } from "@/lib/audio";
import { toPlaybackInput } from "@/lib/audio/playback/playback-input";
import {
  createDefaultChannel,
  getPlaybackChannel,
  getPlaybackSession,
  type PlaybackChannelRecord,
  SINGLE_ACTIVE_CHANNEL_ID,
  SINGLE_STANDBY_CHANNEL_ID,
  setPlaybackSessionActiveChannel,
  upsertPlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { shouldUseNativeSinglePlayback } from "@/lib/collections/settings";
import { validateRadioForMode } from "@/lib/external-url/utils";
import { isSameStation } from "@/lib/stations/external-station-workflow";
import {
  getPlaybackChannelRuntime,
  resetPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import {
  clearManagedPlaybackErrors,
  getChannelPlayVolume,
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

/** A Station switch that failed while the previous Station resumed. */
export type SingleSelectionFailure = {
  message: string;
  station: Radio;
};

type SelectStationOptions = {
  onSwitchFailed?: (failure: SingleSelectionFailure) => void;
  play?: boolean;
};

export type SinglePlayback = {
  activate: () => Promise<void>;
  deactivate: () => Promise<void>;
  reconcileRouting: () => Promise<void>;
  /**
   * Points the current Channel at the Station's current record: another
   * record of the same Station (e.g. its Saved copy) without restarting it,
   * or the same record edited to a new stream, which reconnects to it.
   */
  rebindStation: (station: Radio) => Promise<void>;
  /** Stops and deselects the current Station when it no longer exists. */
  releaseStation: (station: Radio) => Promise<void>;
  /**
   * Selects a Station, keeping the current play state unless `play` asks to
   * start it. When the switch fails and the previous Station resumes,
   * `onSwitchFailed` gets the failure; other failures surface as the Channel
   * error.
   */
  selectStation: (
    station: Radio,
    options?: SelectStationOptions
  ) => Promise<void>;
  setPlaying: (playing: boolean) => Promise<void>;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
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

/** The Channel already holds this Station with a live sound. */
function isSelected(
  channel: PlaybackChannelRecord | null,
  station: Radio
): boolean {
  return Boolean(
    channel &&
      isSameRadio(channel.radio, station) &&
      getPlaybackChannelRuntime(channel.id).soundId
  );
}

function createSingleSound(
  channel: PlaybackChannelRecord,
  station: Radio,
  soundId: string | undefined,
  ctx: PlaybackActionContext
): string {
  const createdSoundId = createManagedSound(
    "single",
    channel.id,
    station,
    soundId,
    ctx
  );
  if (channel.muted) {
    ctx.channels.setMuted("single", channel.id, true);
  }
  return createdSoundId;
}

async function selectStation(
  station: Radio,
  selection: SelectionState,
  ctx: PlaybackActionContext,
  signal: AbortSignal,
  onSwitchFailed?: (failure: SingleSelectionFailure) => void
): Promise<void> {
  if (signal.aborted) {
    throw abortReason(signal);
  }
  validateRadioForMode(station, "single");

  const channel = getSelectionChannel();
  // A superseded switch restores the previous record without its sound, so a
  // queued switch back to it must recreate the sound rather than stop here.
  if (!channel || isSelected(channel, station)) {
    return;
  }

  cleanupManagedChannel(channel.id, ctx);
  upsertPlaybackChannel("single", { ...channel, radio: station });
  setPlaybackSessionActiveChannel("single", channel.id);
  let playbackAttempted = false;
  try {
    const soundId = createSingleSound(channel, station, undefined, ctx);
    if (!selection.playbackIntent) {
      return;
    }
    playbackAttempted = true;
    await waitForAbortable(
      playManagedSound("single", soundId, getChannelPlayVolume(channel), ctx),
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
    await fallBackFromFailedSwitch({
      channel,
      ctx,
      error,
      onSwitchFailed,
      // Paused while the switch was pending: fall back quietly.
      quiet: !selection.playbackIntent && playbackAttempted,
      selection,
      station,
    });
  }
}

/**
 * Whether two records of a Station play through the same sound: an edit to
 * its stream, stream format or a platform detail that changes how it loads
 * needs a new one, as a Node lane's does.
 */
function loadsTheSame(current: Radio, edited: Radio): boolean {
  return (
    JSON.stringify([current.streamUrl, toPlaybackInput(current)]) ===
    JSON.stringify([edited.streamUrl, toPlaybackInput(edited)])
  );
}

/** Moves the selected Station's sound to the stream its record now has. */
async function reconnectEditedStation(
  station: Radio,
  selection: SelectionState,
  ctx: PlaybackActionContext,
  signal: AbortSignal
): Promise<void> {
  const channel = getSelectionChannel();
  if (
    !channel?.radio ||
    channel.radio.id !== station.id ||
    loadsTheSame(channel.radio, station)
  ) {
    return;
  }
  validateRadioForMode(station, "single");
  const { soundId } = getPlaybackChannelRuntime(channel.id);
  const edited = { ...channel, radio: station };
  upsertPlaybackChannel("single", edited);
  if (!soundId) {
    return;
  }
  cleanupManagedChannel(channel.id, ctx);
  const nextSoundId = createSingleSound(edited, station, soundId, ctx);
  if (!selection.playbackIntent) {
    return;
  }
  try {
    await waitForAbortable(
      playManagedSound(
        "single",
        nextSoundId,
        getChannelPlayVolume(edited),
        ctx
      ),
      signal
    );
  } catch (error) {
    if (signal.aborted) {
      throw abortReason(signal);
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

/** Restores the previous Station after a failed switch and reports it. */
async function fallBackFromFailedSwitch({
  channel,
  ctx,
  error,
  onSwitchFailed,
  quiet,
  selection,
  station,
}: {
  channel: PlaybackChannelRecord;
  ctx: PlaybackActionContext;
  error: unknown;
  onSwitchFailed?: (failure: SingleSelectionFailure) => void;
  quiet: boolean;
  selection: SelectionState;
  station: Radio;
}): Promise<void> {
  const reportedError = quiet
    ? null
    : reportPlaybackActionError(ctx.reportError, {
        cause: error,
        channelId: channel.id,
        code: "PLAY_ERROR",
        mode: "single",
        radio: station,
      });
  if (!(channel.radio && selection.rollbackSoundId)) {
    if (reportedError) {
      throw reportedError;
    }
    return;
  }
  // The previous Station comes back, so the failure belongs to the Station
  // that failed rather than inline under the one that resumes.
  if (reportedError) {
    onSwitchFailed?.({ message: reportedError.userMessage, station });
  }
  const restoredSoundId = createSingleSound(
    channel,
    channel.radio,
    selection.rollbackSoundId,
    ctx
  );
  if (selection.playbackIntent) {
    await playManagedSound(
      "single",
      restoredSoundId,
      getChannelPlayVolume(channel),
      ctx
    );
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
  createSingleSound(channel, channel.radio, soundId, ctx);
  if (!shouldResume) {
    return;
  }
  try {
    await playManagedSound(
      "single",
      soundId,
      getChannelPlayVolume(channel),
      ctx
    );
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
  // What Unmute restores after the volume slider was dragged down to zero.
  let unmutedVolume = 1;

  const setPlaying = async (playing: boolean) => {
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
  };

  const setMuted = (channelId: string, muted: boolean, volume: number) => {
    ctx.channels.setMuted("single", channelId, muted);
    if (!muted) {
      // The engine restores its own pre-mute gain, which is unset after a
      // reload; re-apply the persisted Channel volume instead.
      ctx.channels.setVolume("single", channelId, volume);
    }
  };

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
    async rebindStation(station) {
      const channel = getSelectionChannel();
      if (!channel?.radio) {
        return;
      }
      if (channel.radio.id !== station.id) {
        if (isSameStation(channel.radio, station)) {
          upsertPlaybackChannel("single", { ...channel, radio: station });
        }
        return;
      }
      if (loadsTheSame(channel.radio, station)) {
        return;
      }
      playingRevision += 1;
      clearManagedPlaybackErrors(SINGLE_CHANNEL_IDS);
      const runtime = getPlaybackChannelRuntime(channel.id);
      // Still connecting counts as playing, so an edit then resumes it.
      const resume = runtime.isPlaying || runtime.isLoading;
      try {
        await selection.runSelection(resume, null, (signal, state) =>
          reconnectEditedStation(station, state, ctx, signal)
        );
      } catch (error) {
        setManagedPlaybackError(channel.id, error, station);
      }
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
    async releaseStation(station) {
      if (!isSameRadio(getSelectionChannel()?.radio, station)) {
        return;
      }
      playingRevision += 1;
      // Queued as a selection so an in-flight connect to it is abandoned.
      await selection.runSelection(false, null, () => {
        const channel = getSelectionChannel();
        if (channel && isSameRadio(channel.radio, station)) {
          cleanupManagedChannel(channel.id, ctx);
          upsertPlaybackChannel("single", { ...channel, radio: null });
        }
        return Promise.resolve();
      });
    },
    async selectStation(station, { onSwitchFailed, play = false } = {}) {
      const channel = getSelectionChannel();
      if (channel && isSelected(channel, station)) {
        if (play && !getPlaybackChannelRuntime(channel.id).isPlaying) {
          await setPlaying(true);
        }
        return;
      }
      playingRevision += 1;
      clearManagedPlaybackErrors(SINGLE_CHANNEL_IDS);
      const runtime = channel ? getPlaybackChannelRuntime(channel.id) : null;
      if (play) {
        selection.updatePlaybackIntent(true);
      }
      try {
        await selection.runSelection(
          play || (runtime?.isPlaying ?? false),
          runtime?.soundId ?? null,
          (signal, state) =>
            selectStation(station, state, ctx, signal, onSwitchFailed)
        );
      } catch (error) {
        setManagedPlaybackError(
          channel?.id ?? SINGLE_ACTIVE_CHANNEL_ID,
          error,
          station
        );
      }
    },
    setPlaying,
    setVolume(volume) {
      const channel = getSelectionChannel();
      const channelId = channel?.id ?? SINGLE_ACTIVE_CHANNEL_ID;
      const audibleVolume = volume > 0 ? volume : channel?.volume;
      if (audibleVolume && audibleVolume > 0) {
        unmutedVolume = audibleVolume;
      }
      if (volume > 0 && channel?.muted) {
        ctx.channels.setMuted("single", channelId, false);
      }
      ctx.channels.setVolume("single", channelId, volume);
    },
    toggleMute() {
      const channel = getSelectionChannel();
      if (!channel) {
        return;
      }
      // A slider dragged to zero, or a session muted before the flag
      // existed, stored volume 0 instead.
      const volume = channel.volume > 0 ? channel.volume : unmutedVolume;
      if (channel.muted || channel.volume === 0) {
        setMuted(channel.id, false, volume);
        return;
      }
      setMuted(channel.id, true, volume);
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
