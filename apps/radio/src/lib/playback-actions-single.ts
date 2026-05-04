import type { Radio } from "@/lib/audio";
import { createManagedPlaybackSessionWorkflow } from "./managed-playback-session-workflow.js";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "./playback-action-context.js";

export function setSingleChannelVolume(
  channelId: string,
  volume: number,
  ctx = getDefaultPlaybackActionContext()
): void {
  createManagedPlaybackSessionWorkflow("single", { ctx }).setChannelVolume(
    channelId,
    volume
  );
}

export function setSinglePlaybackState(
  playing: boolean,
  ctx = getDefaultPlaybackActionContext()
): Promise<void> {
  return createManagedPlaybackSessionWorkflow("single", { ctx }).setPlaying(
    playing
  );
}

export function selectSinglePlaybackRadio(
  radio: Radio,
  transitionDuration: number,
  ctx: PlaybackActionContext = getDefaultPlaybackActionContext()
): Promise<void> {
  return createManagedPlaybackSessionWorkflow("single", { ctx }).selectRadio(
    radio,
    transitionDuration
  );
}
