import type { Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  getMultipleChannelId,
  getPlaybackChannel,
  getPlaybackSession,
  type PlaybackChannelRecord,
  removePlaybackChannel,
  replacePlaybackChannels,
  updatePlaybackChannel,
  updatePlaybackSession,
  upsertPlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { getSettings } from "@/lib/collections/settings";
import { validateRadioForMode } from "@/lib/external-url/utils";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";
import {
  applySessionMasterVolume,
  cleanupManagedChannel,
  createManagedSound,
  ensureMainAudioSettingsApplied,
  getAudioManager,
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

export function syncMultiplePlaybackChannels(radios: Radio[]): void {
  const existingChannels = getPlaybackSession("multiple")?.channels ?? [];
  const nextChannelIds = new Set(
    radios.map((radio) => getMultipleChannelId(radio))
  );

  for (const channel of existingChannels) {
    if (!nextChannelIds.has(channel.id)) {
      cleanupManagedChannel(channel.id);
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

export function removeMultiplePlaybackChannel(channelId: string): void {
  cleanupManagedChannel(channelId);
  removePlaybackChannel("multiple", channelId);
}

export async function setMultipleChannelPlaying(
  channelId: string,
  playing: boolean
): Promise<void> {
  const channel = getPlaybackChannel("multiple", channelId);
  if (!channel?.radio) {
    return;
  }

  validateRadioForMode(channel.radio, "multiple");

  if (!playing) {
    const runtime = getPlaybackChannelRuntime(channelId);
    if (runtime.soundId) {
      getAudioManager().pauseSound(runtime.soundId);
    }
    return;
  }

  const runtime = getPlaybackChannelRuntime(channelId);
  const soundId =
    runtime.soundId ?? createManagedSound("multiple", channelId, channel.radio);

  await ensureMainAudioSettingsApplied();
  applySessionMasterVolume("multiple");
  await getAudioManager().playSound(soundId, channel.volume);
}

export function setMultipleChannelVolume(
  channelId: string,
  volume: number
): void {
  updatePlaybackChannel("multiple", channelId, (draft) => {
    draft.volume = volume;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().setVolume(runtime.soundId, volume);
  }
}

export function setMultipleSessionMasterVolume(volume: number): void {
  updatePlaybackSession("multiple", (draft) => {
    draft.masterVolume = volume;
  });
  if ((getSettings()?.player.mode ?? "single") === "multiple") {
    getAudioManager().setGlobalVolume(volume);
  }
}

export async function playAllMultipleChannels(): Promise<void> {
  const channels = getPlaybackSession("multiple")?.channels ?? [];
  for (const channel of channels) {
    await setMultipleChannelPlaying(channel.id, true);
  }
}

export function pauseAllMultipleChannels(): void {
  const channels = getPlaybackSession("multiple")?.channels ?? [];
  for (const channel of channels) {
    const runtime = getPlaybackChannelRuntime(channel.id);
    if (runtime.soundId) {
      getAudioManager().pauseSound(runtime.soundId);
    }
  }
}
