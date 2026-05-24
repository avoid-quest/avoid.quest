import { crossfade, type Radio } from "@/lib/audio";
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
  SINGLE_STANDBY_CHANNEL_ID,
  setPlaybackSessionActiveChannel,
  updatePlaybackChannel,
  updatePlaybackSession,
  upsertPlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { getSettings } from "@/lib/collections/settings";
import { validateRadioForMode } from "@/lib/external-url/utils";
import {
  getPlaybackChannelRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
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
  selectRadio: (radio: Radio, transitionDuration: number) => Promise<void>;
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

function isRestorableManagedRadio(
  radio: Radio | null,
  sessionId: ManagedPlaybackSessionId
): radio is Radio {
  if (!radio) {
    return false;
  }
  if (radio.platformMetadata?.platform === "local-file") {
    return false;
  }
  try {
    validateRadioForMode(radio, sessionId);
    return true;
  } catch {
    return false;
  }
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

function getRestoreChannels(
  sessionId: ManagedPlaybackSessionId,
  session: PlaybackSessionRecord
): PlaybackSessionRecord["channels"] {
  if (sessionId === "single") {
    return session.channels.filter(
      (channel) => channel.id === session.activeChannelId
    );
  }
  return session.channels;
}

function restoreSessionSounds(
  sessionId: ManagedPlaybackSessionId,
  session: PlaybackSessionRecord,
  ctx: PlaybackActionContext
): void {
  for (const channel of getRestoreChannels(sessionId, session)) {
    const runtime = getPlaybackChannelRuntime(channel.id);
    if (!isRestorableManagedRadio(channel.radio, sessionId)) {
      if (runtime.soundId) {
        cleanupManagedChannel(channel.id, ctx);
      }
      resetPlaybackChannelRuntime(channel.id);
      continue;
    }
    if (runtime.soundId) {
      continue;
    }
    createManagedSound(sessionId, channel.id, channel.radio, undefined, ctx);
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

function createDefaultSingleChannel(channelId: string): PlaybackChannelRecord {
  if (channelId === SINGLE_ACTIVE_CHANNEL_ID) {
    return createDefaultChannel(channelId, "single-primary", 0);
  }
  return createDefaultChannel(channelId, "single-secondary", 1);
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
  const gestureResume = startGestureAudioResume(ctx);

  try {
    await ensureMainAudioSettingsApplied(ctx);
    applySessionMasterVolume(sessionId, ctx);
    await gestureResume.wait();
    await ctx.audio.playSound(soundId, channel.volume);
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

async function selectSingleRadio(
  radio: Radio,
  transitionDuration: number,
  ctx: PlaybackActionContext
): Promise<void> {
  validateRadioForMode(radio, "single");

  const session = getPlaybackSession("single");
  if (!session) {
    return;
  }

  const activeChannelId = session.activeChannelId;
  const activeChannel = activeChannelId
    ? (session.channels.find((entry) => entry.id === activeChannelId) ?? null)
    : null;

  if (isSameRadio(activeChannel?.radio, radio)) {
    return;
  }

  const incomingChannelId =
    activeChannelId === SINGLE_ACTIVE_CHANNEL_ID
      ? SINGLE_STANDBY_CHANNEL_ID
      : SINGLE_ACTIVE_CHANNEL_ID;
  const outgoingChannelId =
    activeChannelId === incomingChannelId ? null : activeChannelId;

  const incomingChannel =
    getPlaybackChannel("single", incomingChannelId) ??
    createDefaultSingleChannel(incomingChannelId);

  const previousVolume = activeChannel?.volume ?? incomingChannel.volume;
  upsertPlaybackChannel("single", {
    ...incomingChannel,
    radio,
    volume: previousVolume,
  });

  const incomingSoundId = createManagedSound(
    "single",
    incomingChannelId,
    radio,
    undefined,
    ctx
  );

  const outgoingRuntime = outgoingChannelId
    ? getPlaybackChannelRuntime(outgoingChannelId)
    : null;
  const outgoingSoundId =
    outgoingRuntime?.isPlaying && outgoingRuntime.soundId
      ? outgoingRuntime.soundId
      : null;

  if (!(outgoingChannelId && outgoingSoundId)) {
    if (outgoingChannelId && outgoingRuntime?.soundId) {
      cleanupManagedChannel(outgoingChannelId, ctx);
    }
    setPlaybackSessionActiveChannel("single", incomingChannelId);
    return;
  }

  const gestureResume = startGestureAudioResume(ctx);

  try {
    await ensureMainAudioSettingsApplied(ctx);
    applySessionMasterVolume("single", ctx);
    await gestureResume.wait();
    await ctx.audio.playSound(incomingSoundId, 0);
    await crossfade(outgoingSoundId, incomingSoundId, {
      duration: transitionDuration,
      targetVolume: previousVolume,
      curve: "equalPower",
    });
  } catch (error) {
    throw reportPlaybackActionError(ctx.reportError, {
      mode: "single",
      code: "PLAY_ERROR",
      cause: error,
      channelId: incomingChannelId,
      radio,
    });
  }

  cleanupManagedChannel(outgoingChannelId, ctx);
  updatePlaybackChannel("single", outgoingChannelId, (draft) => {
    draft.radio = null;
    draft.volume = previousVolume;
  });

  setPlaybackSessionActiveChannel("single", incomingChannelId);
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
  return {
    activate: () => activateSession(sessionId, ctx),
    deactivate: () =>
      deactivateSession(sessionId, ctx, fadeOutSound, fadeOutDurationMs),
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
    selectRadio(radio, transitionDuration) {
      if (sessionId !== "single") {
        throw new Error("Radio selection is only supported in single mode");
      }
      return selectSingleRadio(radio, transitionDuration, ctx);
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
