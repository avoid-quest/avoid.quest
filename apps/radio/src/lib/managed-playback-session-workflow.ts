import type { Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  getMultipleChannelId,
  getPlaybackChannel,
  getPlaybackSession,
  type PlaybackChannelRecord,
  type PlaybackSessionId,
  type PlaybackSessionRecord,
  playbackSessionsCollection,
  removePlaybackChannel,
  replacePlaybackChannels,
  SINGLE_ACTIVE_CHANNEL_ID,
  setPlaybackSessionActiveChannel,
  updatePlaybackSession,
  upsertPlaybackChannel,
} from "@/lib/collections/playback-sessions";
import {
  getSettings,
  shouldUseNativeSinglePlayback,
} from "@/lib/collections/settings";
import { validateRadioForMode } from "@/lib/external-url/utils";
import {
  getPlaybackChannelRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { planManagedSessionRestore } from "./managed-playback-session-workflow-policy.js";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "./playback-action-context.js";
import {
  reportPlaybackActionError,
  toRuntimeAudioError,
} from "./playback-action-errors.js";
import {
  applySessionMasterVolume,
  cleanupManagedChannel,
  createManagedSound,
  ensureMainAudioSettingsApplied,
  isSameRadio,
} from "./playback-actions-shared.js";
import {
  getSingleSelectionCoordinator,
  singleSelectionAbortReason,
} from "./single-selection-coordinator.js";

export { mergeMultiplePlaybackRadios } from "./managed-playback-session-workflow-policy.js";

type ManagedPlaybackSessionId = Exclude<PlaybackSessionId, "dj">;

type FadeOutSound = (
  soundId: string,
  durationMs: number,
  stopAfter: boolean
) => Promise<void>;

type CreateManagedPlaybackSessionWorkflowOptions = {
  ctx?: PlaybackActionContext;
  fadeOutDurationMs?: number;
  fadeOutSound?: FadeOutSound;
};

export type ManagedPlaybackSessionWorkflow = {
  activate: () => Promise<void>;
  deactivate: () => Promise<void>;
  syncChannels: (radios: Radio[]) => void;
  addChannel: (radio: Radio, order?: number) => PlaybackChannelRecord;
  removeChannel: (channelId: string) => void;
  selectRadio: (radio: Radio) => Promise<void>;
  setPlaying: (playing: boolean, channelId?: string) => Promise<void>;
  setChannelVolume: (channelId: string, volume: number) => void;
  setMasterVolume: (volume: number) => void;
  playAll: () => Promise<void>;
  pauseAll: () => void;
  clearPlaybackErrors: (channelIds?: string[]) => void;
  setPlaybackError: (channelId: string, error: unknown, radio?: Radio) => void;
};

const DEFAULT_FADE_OUT_DURATION_MS = 150;

const PLAYBACK_MODE_LABELS = {
  multiple: "Multiple",
  single: "Single",
} satisfies Record<ManagedPlaybackSessionId, string>;

function startGestureAudioResume(ctx: PlaybackActionContext): {
  wait: () => Promise<void>;
} {
  let resumeError: unknown = null;
  let resumePromise: Promise<void>;

  try {
    resumePromise = ctx.resumeAudioContext();
  } catch (error) {
    resumeError = error;
    resumePromise = Promise.resolve();
  }

  const handledResume = resumePromise.catch((error: unknown) => {
    resumeError = error;
  });

  return {
    async wait() {
      await handledResume;
      if (resumeError) {
        throw resumeError;
      }
    },
  };
}

function waitForAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(singleSelectionAbortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(singleSelectionAbortReason(signal));
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

async function getReadyPlaybackSession(
  sessionId: ManagedPlaybackSessionId
): Promise<PlaybackSessionRecord> {
  await playbackSessionsCollection.stateWhenReady();
  const session = getPlaybackSession(sessionId);
  if (!session) {
    throw new Error(
      `${PLAYBACK_MODE_LABELS[sessionId]} playback session is not ready`
    );
  }
  return session;
}

function restoreSessionSounds(
  sessionId: ManagedPlaybackSessionId,
  session: PlaybackSessionRecord,
  ctx: PlaybackActionContext
): void {
  const actions = planManagedSessionRestore(
    sessionId,
    session.activeChannelId,
    session.channels.map((channel) => ({
      channelId: channel.id,
      radio: channel.radio,
      soundId: getPlaybackChannelRuntime(channel.id).soundId,
    }))
  );

  for (const action of actions) {
    if (action.type === "create") {
      createManagedSound(
        sessionId,
        action.channelId,
        action.radio,
        undefined,
        ctx
      );
      continue;
    }
    if (action.cleanupSound) {
      cleanupManagedChannel(action.channelId, ctx);
    }
    resetPlaybackChannelRuntime(action.channelId);
  }
}

function getSessionSoundIds(sessionId: ManagedPlaybackSessionId): string[] {
  const session = getPlaybackSession(sessionId);
  if (!session) {
    return [];
  }
  return session.channels
    .map((channel) => getPlaybackChannelRuntime(channel.id).soundId)
    .filter((soundId): soundId is string => Boolean(soundId));
}

async function fadeOutSoundIds(
  soundIds: string[],
  fadeOutSound: FadeOutSound,
  durationMs: number
): Promise<void> {
  await Promise.all(
    soundIds.map((soundId) => fadeOutSound(soundId, durationMs, true))
  );
}

async function activateSession(
  sessionId: ManagedPlaybackSessionId,
  ctx: PlaybackActionContext
): Promise<void> {
  const session = await getReadyPlaybackSession(sessionId);
  restoreSessionSounds(sessionId, session, ctx);
  applySessionMasterVolume(sessionId, ctx);
}

async function deactivateSession(
  sessionId: ManagedPlaybackSessionId,
  ctx: PlaybackActionContext,
  fadeOutSound: FadeOutSound,
  fadeOutDurationMs: number
): Promise<void> {
  await fadeOutSoundIds(
    getSessionSoundIds(sessionId),
    fadeOutSound,
    fadeOutDurationMs
  );

  const session = getPlaybackSession(sessionId);
  for (const channel of session?.channels ?? []) {
    cleanupManagedChannel(channel.id, ctx);
    resetPlaybackChannelRuntime(channel.id);
  }
}

function syncMultipleChannels(
  radios: Radio[],
  ctx: PlaybackActionContext
): void {
  const existingChannels = getPlaybackSession("multiple")?.channels ?? [];
  const existingChannelsById = new Map(
    existingChannels.map((channel) => [channel.id, channel])
  );
  const nextChannelIds = new Set(
    radios.map((radio) => getMultipleChannelId(radio))
  );

  for (const channel of existingChannels) {
    if (!nextChannelIds.has(channel.id)) {
      cleanupManagedChannel(channel.id, ctx);
    }
  }

  const channels = radios.map((radio, index) => {
    const channelId = getMultipleChannelId(radio);
    const existingChannel = existingChannelsById.get(channelId);

    return {
      ...(existingChannel ??
        createDefaultChannel(channelId, "multiple", index)),
      id: channelId,
      role: "multiple" as const,
      radio,
      order: index,
    };
  });
  replacePlaybackChannels("multiple", channels);
}

function addMultipleChannel(
  radio: Radio,
  order?: number
): PlaybackChannelRecord {
  const channelId = getMultipleChannelId(radio);
  const existingChannel = getPlaybackChannel("multiple", channelId);
  const nextOrder =
    order ??
    existingChannel?.order ??
    getPlaybackSession("multiple")?.channels.length ??
    0;
  const channel = {
    ...(existingChannel ??
      createDefaultChannel(channelId, "multiple", nextOrder)),
    id: channelId,
    role: "multiple" as const,
    radio,
    order: nextOrder,
  };
  upsertPlaybackChannel("multiple", channel);
  return channel;
}

async function playManagedSound(
  sessionId: ManagedPlaybackSessionId,
  soundId: string,
  volume: number,
  ctx: PlaybackActionContext
): Promise<void> {
  applySessionMasterVolume(sessionId, ctx);
  if (sessionId === "single" && shouldUseNativeSinglePlayback()) {
    await ctx.audio.playSound(soundId, volume);
    return;
  }

  const gestureResume = startGestureAudioResume(ctx);
  const settingsPromise = ensureMainAudioSettingsApplied(ctx);
  const playPromise = ctx.audio.playSound(soundId, volume);
  await Promise.all([settingsPromise, gestureResume.wait(), playPromise]);
}

async function setSinglePlaying(
  playing: boolean,
  ctx: PlaybackActionContext
): Promise<void> {
  const session = getPlaybackSession("single");
  const activeChannelId = session?.activeChannelId;
  if (!activeChannelId) {
    return;
  }
  await setChannelPlaying("single", activeChannelId, playing, ctx);
}

async function setChannelPlaying(
  sessionId: ManagedPlaybackSessionId,
  channelId: string,
  playing: boolean,
  ctx: PlaybackActionContext
): Promise<void> {
  const channel = getPlaybackChannel(sessionId, channelId);
  if (!channel?.radio) {
    return;
  }

  validateRadioForMode(channel.radio, sessionId);

  const runtime = getPlaybackChannelRuntime(channelId);
  if (!playing) {
    if (runtime.soundId) {
      ctx.audio.pauseSound(runtime.soundId);
    }
    return;
  }

  const soundId =
    runtime.soundId ??
    createManagedSound(sessionId, channelId, channel.radio, undefined, ctx);
  try {
    await playManagedSound(sessionId, soundId, channel.volume, ctx);
  } catch (error) {
    throw reportPlaybackActionError(ctx.reportError, {
      mode: sessionId,
      code: "PLAY_ERROR",
      cause: error,
      channelId,
      radio: channel.radio,
    });
  }
}

function getSingleSelectionChannel(): PlaybackChannelRecord | null {
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

async function selectSingleRadio(
  radio: Radio,
  shouldPlay: boolean,
  ctx: PlaybackActionContext,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) {
    throw singleSelectionAbortReason(signal);
  }
  validateRadioForMode(radio, "single");

  const channel = getSingleSelectionChannel();
  if (!channel || isSameRadio(channel.radio, radio)) {
    return;
  }

  cleanupManagedChannel(channel.id, ctx);
  upsertPlaybackChannel("single", { ...channel, radio });
  setPlaybackSessionActiveChannel("single", channel.id);
  try {
    const soundId = createManagedSound(
      "single",
      channel.id,
      radio,
      undefined,
      ctx
    );
    if (!shouldPlay) {
      return;
    }

    await waitForAbortable(
      playManagedSound("single", soundId, channel.volume, ctx),
      signal
    );
    if (signal.aborted) {
      throw singleSelectionAbortReason(signal);
    }
  } catch (error) {
    cleanupManagedChannel(channel.id, ctx);
    if (signal.aborted) {
      throw singleSelectionAbortReason(signal);
    }
    throw reportPlaybackActionError(ctx.reportError, {
      mode: "single",
      code: "PLAY_ERROR",
      cause: error,
      channelId: channel.id,
      radio,
    });
  }
}

function setSessionMasterVolume(
  sessionId: ManagedPlaybackSessionId,
  volume: number,
  ctx: PlaybackActionContext
): void {
  updatePlaybackSession(sessionId, (draft) => {
    draft.masterVolume = volume;
  });
  if ((getSettings()?.player.mode ?? "single") === sessionId) {
    ctx.audio.setGlobalVolume(volume);
  }
}

function pauseSessionChannels(
  sessionId: ManagedPlaybackSessionId,
  ctx: PlaybackActionContext
): void {
  const channels = getPlaybackSession(sessionId)?.channels ?? [];
  for (const channel of channels) {
    const runtime = getPlaybackChannelRuntime(channel.id);
    if (runtime.soundId) {
      ctx.audio.pauseSound(runtime.soundId);
    }
  }
}

function clearPlaybackErrors(
  sessionId: ManagedPlaybackSessionId,
  channelIds?: string[]
): void {
  const ids =
    channelIds ??
    getPlaybackSession(sessionId)?.channels.map((channel) => channel.id) ??
    [];
  for (const channelId of ids) {
    setPlaybackChannelRuntime(channelId, () => ({ error: null }));
  }
}

function setPlaybackError(
  channelId: string,
  error: unknown,
  radio?: Radio
): void {
  setPlaybackChannelRuntime(channelId, () => ({
    isLoading: false,
    error: toRuntimeAudioError(error, "PLAY_ERROR", radio),
  }));
}

export function createManagedPlaybackSessionWorkflow(
  sessionId: ManagedPlaybackSessionId,
  {
    ctx = getDefaultPlaybackActionContext(),
    fadeOutDurationMs = DEFAULT_FADE_OUT_DURATION_MS,
    fadeOutSound = async () => undefined,
  }: CreateManagedPlaybackSessionWorkflowOptions = {}
): ManagedPlaybackSessionWorkflow {
  const singleSelection =
    sessionId === "single" ? getSingleSelectionCoordinator(ctx) : null;

  return {
    activate: () => activateSession(sessionId, ctx),
    deactivate: async () => {
      const deactivate = () =>
        deactivateSession(sessionId, ctx, fadeOutSound, fadeOutDurationMs);
      if (singleSelection) {
        await singleSelection.cancelAndRun(deactivate);
      } else {
        await deactivate();
      }
    },
    syncChannels(radios) {
      if (sessionId === "multiple") {
        syncMultipleChannels(radios, ctx);
      }
    },
    addChannel(radio, order) {
      if (sessionId !== "multiple") {
        throw new Error("Channels can only be added to multiple mode");
      }
      return addMultipleChannel(radio, order);
    },
    removeChannel(channelId) {
      if (sessionId !== "multiple") {
        return;
      }
      cleanupManagedChannel(channelId, ctx);
      removePlaybackChannel("multiple", channelId);
    },
    selectRadio(radio) {
      if (sessionId !== "single" || !singleSelection) {
        throw new Error("Radio selection is only supported in single mode");
      }
      const channel = getSingleSelectionChannel();
      const shouldPlay = channel
        ? getPlaybackChannelRuntime(channel.id).isPlaying
        : false;
      return singleSelection.run((signal) =>
        selectSingleRadio(radio, shouldPlay, ctx, signal)
      );
    },
    setPlaying(playing, channelId) {
      if (sessionId === "single") {
        return setSinglePlaying(playing, ctx);
      }
      if (!channelId) {
        return Promise.resolve();
      }
      return setChannelPlaying("multiple", channelId, playing, ctx);
    },
    setChannelVolume(channelId, volume) {
      ctx.channels.setVolume(sessionId, channelId, volume);
    },
    setMasterVolume(volume) {
      setSessionMasterVolume(sessionId, volume, ctx);
    },
    async playAll() {
      const channels = getPlaybackSession(sessionId)?.channels ?? [];
      await Promise.allSettled(
        channels.map((channel) =>
          setChannelPlaying(sessionId, channel.id, true, ctx)
        )
      );
    },
    pauseAll() {
      pauseSessionChannels(sessionId, ctx);
    },
    clearPlaybackErrors(channelIds) {
      clearPlaybackErrors(sessionId, channelIds);
    },
    setPlaybackError,
  };
}
