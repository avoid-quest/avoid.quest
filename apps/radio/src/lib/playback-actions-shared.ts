import type { AudioManager, Radio } from "@/lib/audio";
import {
  getPlaybackSession,
  type PlaybackSessionId,
} from "@/lib/collections/playback-sessions";
import { getAudioSettings, getDelaySettings } from "@/lib/collections/settings";
import { getMainOutputRouter } from "@/lib/main-output-router";
import { resetAllPlaybackRuntime } from "@/lib/stores/playback-runtime-store";
import type {
  ChannelActivationOptions,
  ChannelRuntimeSubscriptionOptions,
} from "./channel-state-manager.js";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
  resetDefaultPlaybackActionContext,
} from "./playback-action-context.js";

export function getAudioManager(): AudioManager {
  return getDefaultPlaybackActionContext().audio;
}

export function isSameRadio(
  a: Radio | null | undefined,
  b: Radio | null | undefined
): boolean {
  if (!(a && b)) {
    return false;
  }
  if (a.id !== undefined && b.id !== undefined) {
    return String(a.id) === String(b.id);
  }
  return a.streamUrl === b.streamUrl;
}

function getPlaybackOutputRouter(ctx: PlaybackActionContext) {
  return ctx.getMainOutputRouter() ?? getMainOutputRouter();
}

export async function applyMainOutputDevice(
  deviceId: string,
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  const router = getPlaybackOutputRouter(ctx);
  if (router) {
    await router.setMainOutput(deviceId);
  }
}

export async function applyCurrentMainAudioSettings(
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  const router = getPlaybackOutputRouter(ctx);
  if (!router) {
    ctx.lifecycle.mainOutputSettingsApplied = false;
    return;
  }

  const settings = getAudioSettings();
  if (settings.mainOutputId && settings.mainOutputId !== "default") {
    await router.setMainOutput(settings.mainOutputId);
  }

  const { mainDelayMs } = getDelaySettings();
  ctx.audio.setMainDelay(mainDelayMs);
  ctx.lifecycle.mainOutputSettingsApplied = true;
}

export async function ensureMainAudioSettingsApplied(
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  if (!ctx.lifecycle.mainOutputSettingsApplied) {
    await applyCurrentMainAudioSettings(ctx);
  }
}

export function resetManagedAudioState(
  ctx = getDefaultPlaybackActionContext()
): void {
  ctx.channels.clearSubscriptionCleanups();
  ctx.resetAudioManager();
  resetAllPlaybackRuntime();
  ctx.lifecycle.mainOutputSettingsApplied = false;
  resetDefaultPlaybackActionContext();
}

function getSessionMasterVolume(sessionId: PlaybackSessionId): number {
  return getPlaybackSession(sessionId)?.masterVolume ?? 1;
}

export function applySessionMasterVolume(
  sessionId: PlaybackSessionId,
  ctx = getDefaultPlaybackActionContext()
): void {
  ctx.audio.setGlobalVolume(getSessionMasterVolume(sessionId));
}

export function getDefaultSoundId(
  sessionId: PlaybackSessionId,
  channelId: string
): string {
  return `${sessionId}:${channelId}`;
}

export function subscribeManagedChannel(
  sessionId: PlaybackSessionId,
  channelId: string,
  soundId: string,
  options: ChannelRuntimeSubscriptionOptions = {},
  ctx: PlaybackActionContext = getDefaultPlaybackActionContext()
): void {
  ctx.channels.subscribeRuntime(sessionId, channelId, soundId, options);
}

export function createManagedSound(
  sessionId: PlaybackSessionId,
  channelId: string,
  radio: Radio,
  optionsOrSoundId: string | ChannelActivationOptions = {},
  ctx = getDefaultPlaybackActionContext()
): string {
  const options =
    typeof optionsOrSoundId === "string"
      ? { soundId: optionsOrSoundId }
      : optionsOrSoundId;
  const soundId = options.soundId ?? getDefaultSoundId(sessionId, channelId);
  if (!options.onAudioState) {
    return ctx.channels.activate(sessionId, channelId, radio, soundId);
  }
  return ctx.channels.activate(sessionId, channelId, radio, {
    ...options,
    soundId,
  });
}

export function cleanupManagedChannel(
  channelId: string,
  ctx = getDefaultPlaybackActionContext()
): void {
  ctx.channels.deactivate(channelId);
}

export function cleanupPlaybackSessionAudio(
  sessionId: PlaybackSessionId,
  ctx = getDefaultPlaybackActionContext()
): void {
  const session = getPlaybackSession(sessionId);
  if (!session) {
    return;
  }
  for (const channel of session.channels) {
    cleanupManagedChannel(channel.id, ctx);
  }
}

export function cleanupAudioForModeChange(
  nextMode: PlaybackSessionId,
  ctx = getDefaultPlaybackActionContext()
): void {
  for (const sessionId of ["single", "multiple", "dj"] as const) {
    if (sessionId !== nextMode) {
      cleanupPlaybackSessionAudio(sessionId, ctx);
    }
  }
  ctx.lifecycle.mainOutputSettingsApplied = false;
  applySessionMasterVolume(nextMode, ctx);
}
