import type { Radio } from "@/lib/audio";
import type { PlaybackChannelRecord } from "@/lib/collections/playback-sessions";
import { createManagedPlaybackSessionWorkflow } from "./managed-playback-session-workflow.js";
import { getDefaultPlaybackActionContext } from "./playback-action-context.js";

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
  createManagedPlaybackSessionWorkflow("multiple", { ctx }).syncChannels(
    radios
  );
}

export function addMultiplePlaybackChannel(
  radio: Radio,
  order?: number
): PlaybackChannelRecord {
  return createManagedPlaybackSessionWorkflow("multiple").addChannel(
    radio,
    order
  );
}

export function removeMultiplePlaybackChannel(
  channelId: string,
  ctx = getDefaultPlaybackActionContext()
): void {
  createManagedPlaybackSessionWorkflow("multiple", { ctx }).removeChannel(
    channelId
  );
}

export async function setMultipleChannelPlaying(
  channelId: string,
  playing: boolean,
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  await createManagedPlaybackSessionWorkflow("multiple", { ctx }).setPlaying(
    playing,
    channelId
  );
}

export function setMultipleChannelVolume(
  channelId: string,
  volume: number,
  ctx = getDefaultPlaybackActionContext()
): void {
  createManagedPlaybackSessionWorkflow("multiple", { ctx }).setChannelVolume(
    channelId,
    volume
  );
}

export function setMultipleSessionMasterVolume(
  volume: number,
  ctx = getDefaultPlaybackActionContext()
): void {
  createManagedPlaybackSessionWorkflow("multiple", { ctx }).setMasterVolume(
    volume
  );
}

export async function playAllMultipleChannels(
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  await createManagedPlaybackSessionWorkflow("multiple", { ctx }).playAll();
}

export function pauseAllMultipleChannels(
  ctx = getDefaultPlaybackActionContext()
): void {
  createManagedPlaybackSessionWorkflow("multiple", { ctx }).pauseAll();
}
