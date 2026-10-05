import type { Radio } from "@/lib/audio";
import {
  getPlaybackSession,
  type PlaybackSessionId,
} from "@/lib/collections/playback-sessions";
import { getAudioSettings, getDelaySettings } from "@/lib/collections/settings";
import { getOutputRouting } from "@/lib/output-routing.js";
import type { ChannelActivationOptions } from "./channel-state-manager.js";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
  resetDefaultPlaybackActionContext,
} from "./playback-action-context.js";

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
  return ctx.getMainOutputRouter() ?? getOutputRouting();
}

async function applyCurrentMainAudioSettings(
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  const router = getPlaybackOutputRouter(ctx);
  if (!router) {
    ctx.lifecycle.mainOutputSettingsApplied = false;
    return;
  }

  const settings = getAudioSettings();
  const { mainDelayMs } = getDelaySettings();
  await router.applyMainSettings({
    mainDelayMs,
    mainOutputId: settings.mainOutputId,
  });
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
  ctx.channels.deactivateAll();
  ctx.resetAudioManager();
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

function getDefaultSoundId(
  sessionId: PlaybackSessionId,
  channelId: string
): string {
  return `${sessionId}:${channelId}`;
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

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Runs `task` over `items` with at most `limit` in flight, yielding to the
 * browser between items so a batch of stream starts cannot starve the page.
 */
export async function runWithConcurrency<T>(
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
