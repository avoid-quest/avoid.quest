import type { Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  getMultipleChannelId,
  getPlaybackChannel,
  getPlaybackSession,
  type PlaybackChannelRecord,
  removePlaybackChannel,
  replacePlaybackChannels,
  updatePlaybackSession,
  upsertPlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { getSettings } from "@/lib/collections/settings";
import { validateRadioForMode } from "@/lib/external-url/utils";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";
import { getDefaultPlaybackActionContext } from "./playback-action-context.js";
import { reportPlaybackActionError } from "./playback-action-errors.js";
import {
  applySessionMasterVolume,
  cleanupManagedChannel,
  createManagedSound,
  ensureMainAudioSettingsApplied,
} from "./playback-actions-shared.js";

export function mergeMultiplePlaybackRadios(
  radios: Radio[],
  sessionRadios: Radio[]
): Radio[] {
  return [
    ...radios,
    ...sessionRadios.filter(
      (sessionRadio) => !radios.some((radio) => radio.id === sessionRadio.id)
    ),
  ];
}

export function syncMultiplePlaybackChannels(
  radios: Radio[],
  ctx = getDefaultPlaybackActionContext()
): void {
  const existingChannels = getPlaybackSession("multiple")?.channels ?? [];
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
    const existingChannel = existingChannels.find(
      (channel) => channel.id === channelId
    );

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

export function addMultiplePlaybackChannel(
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

export function removeMultiplePlaybackChannel(
  channelId: string,
  ctx = getDefaultPlaybackActionContext()
): void {
  cleanupManagedChannel(channelId, ctx);
  removePlaybackChannel("multiple", channelId);
}

export async function setMultipleChannelPlaying(
  channelId: string,
  playing: boolean,
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  const channel = getPlaybackChannel("multiple", channelId);
  if (!channel?.radio) {
    return;
  }

  validateRadioForMode(channel.radio, "multiple");

  if (!playing) {
    const runtime = getPlaybackChannelRuntime(channelId);
    if (runtime.soundId) {
      ctx.audio.pauseSound(runtime.soundId);
    }
    return;
  }

  const runtime = getPlaybackChannelRuntime(channelId);
  const soundId =
    runtime.soundId ??
    createManagedSound("multiple", channelId, channel.radio, undefined, ctx);

  try {
    await ensureMainAudioSettingsApplied(ctx);
    applySessionMasterVolume("multiple", ctx);
    await ctx.audio.playSound(soundId, channel.volume);
  } catch (error) {
    throw reportPlaybackActionError(ctx.reportError, {
      mode: "multiple",
      code: "PLAY_ERROR",
      cause: error,
      channelId,
      radio: channel.radio,
    });
  }
}

export function setMultipleChannelVolume(
  channelId: string,
  volume: number,
  ctx = getDefaultPlaybackActionContext()
): void {
  ctx.channels.setVolume("multiple", channelId, volume);
}

export function setMultipleSessionMasterVolume(
  volume: number,
  ctx = getDefaultPlaybackActionContext()
): void {
  updatePlaybackSession("multiple", (draft) => {
    draft.masterVolume = volume;
  });
  if ((getSettings()?.player.mode ?? "single") === "multiple") {
    ctx.audio.setGlobalVolume(volume);
  }
}

export async function playAllMultipleChannels(
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  const channels = getPlaybackSession("multiple")?.channels ?? [];
  await Promise.allSettled(
    channels.map((channel) => setMultipleChannelPlaying(channel.id, true, ctx))
  );
}

export function pauseAllMultipleChannels(
  ctx = getDefaultPlaybackActionContext()
): void {
  const channels = getPlaybackSession("multiple")?.channels ?? [];
  for (const channel of channels) {
    const runtime = getPlaybackChannelRuntime(channel.id);
    if (runtime.soundId) {
      ctx.audio.pauseSound(runtime.soundId);
    }
  }
}
