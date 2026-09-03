import type { Radio } from "@/lib/audio";
import {
  getPlaybackSession,
  type PlaybackChannelRecord,
  type PlaybackSessionId,
  type PlaybackSessionRecord,
  playbackSessionsCollection,
  updatePlaybackSession,
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
import type { PlaybackActionContext } from "./playback-action-context.js";
import { toRuntimeAudioError } from "./playback-action-errors.js";
import {
  applySessionMasterVolume,
  cleanupManagedChannel,
  createManagedSound,
  ensureMainAudioSettingsApplied,
} from "./playback-actions-shared.js";

export type ManagedPlaybackSessionId = Exclude<PlaybackSessionId, "dj">;

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

export async function getReadyManagedPlaybackSession(
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

function isRestorableRadio(
  radio: Radio | null,
  sessionId: ManagedPlaybackSessionId
): radio is Radio {
  if (!radio || radio.platformMetadata?.platform === "local-file") {
    return false;
  }
  try {
    validateRadioForMode(radio, sessionId);
    return true;
  } catch {
    return false;
  }
}

export function restoreManagedChannels(
  sessionId: ManagedPlaybackSessionId,
  channels: readonly PlaybackChannelRecord[],
  ctx: PlaybackActionContext
): void {
  for (const channel of channels) {
    const runtime = getPlaybackChannelRuntime(channel.id);
    if (!isRestorableRadio(channel.radio, sessionId)) {
      if (runtime.soundId) {
        cleanupManagedChannel(channel.id, ctx);
      }
      resetPlaybackChannelRuntime(channel.id);
      continue;
    }
    if (!runtime.soundId) {
      createManagedSound(sessionId, channel.id, channel.radio, undefined, ctx);
      ctx.channels.setMuted(sessionId, channel.id, channel.muted);
    }
  }
}

export async function playManagedSound(
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
  await Promise.all([
    ensureMainAudioSettingsApplied(ctx),
    gestureResume.wait(),
    ctx.audio.playSound(soundId, volume),
  ]);
}

export async function setManagedChannelPlaying(
  sessionId: ManagedPlaybackSessionId,
  channel: PlaybackChannelRecord | undefined,
  playing: boolean,
  ctx: PlaybackActionContext
): Promise<void> {
  if (!channel?.radio) {
    return;
  }

  const runtime = getPlaybackChannelRuntime(channel.id);
  if (!playing) {
    if (runtime.soundId) {
      ctx.audio.pauseSound(runtime.soundId);
    }
    return;
  }

  validateRadioForMode(channel.radio, sessionId);
  let { soundId } = runtime;
  if (!soundId) {
    soundId = createManagedSound(
      sessionId,
      channel.id,
      channel.radio,
      undefined,
      ctx
    );
    ctx.channels.setMuted(sessionId, channel.id, channel.muted);
  }
  await playManagedSound(sessionId, soundId, channel.volume, ctx);
}

export function clearManagedPlaybackErrors(
  channelIds: readonly string[]
): void {
  for (const channelId of channelIds) {
    setPlaybackChannelRuntime(channelId, () => ({ error: null }));
  }
}

export function setManagedPlaybackError(
  channelId: string,
  error: unknown,
  radio?: Radio
): void {
  setPlaybackChannelRuntime(channelId, () => ({
    error: toRuntimeAudioError(error, "PLAY_ERROR", radio),
    isLoading: false,
  }));
}

export function setManagedSessionMasterVolume(
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
