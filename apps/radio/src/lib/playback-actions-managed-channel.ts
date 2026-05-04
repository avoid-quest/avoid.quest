import type { EffectConfig, FilterConfig } from "@/lib/audio";
import {
  addChannelEffect,
  removeChannelEffect,
  reorderChannelEffects,
  setChannelEffectsDryWet,
  setChannelFilterValue,
  setChannelMuted,
  setChannelPan,
  setChannelSpeed,
  updateChannel,
  updateChannelEffect,
  updateChannelFilter,
} from "@/lib/channel-state-manager";
import type {
  PlaybackChannelRecord,
  PlaybackSessionId,
} from "@/lib/collections/playback-sessions";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";
import { getDefaultPlaybackActionContext } from "./playback-action-context.js";

export function updateManagedChannel(
  sessionId: PlaybackSessionId,
  channelId: string,
  updater: (draft: PlaybackChannelRecord) => void
): void {
  updateChannel(sessionId, channelId, updater);
}

export function updateManagedChannelFilter(
  sessionId: PlaybackSessionId,
  channelId: string,
  filter: FilterConfig
): void {
  updateChannelFilter(sessionId, channelId, filter);
}

export function setManagedChannelEffectsDryWet(
  sessionId: PlaybackSessionId,
  channelId: string,
  value: number
): void {
  setChannelEffectsDryWet(sessionId, channelId, value);
}

export function setManagedChannelPan(
  sessionId: PlaybackSessionId,
  channelId: string,
  pan: number
): void {
  setChannelPan(sessionId, channelId, pan);
}

export function setManagedChannelSpeed(
  sessionId: PlaybackSessionId,
  channelId: string,
  speed: number
): void {
  setChannelSpeed(sessionId, channelId, speed);
}

export function setManagedChannelMuted(
  sessionId: PlaybackSessionId,
  channelId: string,
  muted: boolean
): void {
  setChannelMuted(sessionId, channelId, muted);
}

export function setManagedChannelRepeat(
  sessionId: PlaybackSessionId,
  channelId: string,
  repeat: boolean
): void {
  updateChannel(sessionId, channelId, { repeat });
}

export function setManagedChannelAutoplay(
  sessionId: PlaybackSessionId,
  channelId: string,
  autoplay: boolean
): void {
  updateChannel(sessionId, channelId, { autoplay });
}

export function seekManagedChannel(
  channelId: string,
  position: number,
  ctx = getDefaultPlaybackActionContext()
): void {
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    ctx.audio.seekSound(runtime.soundId, position);
  }
}

export function setManagedChannelFilterValue(
  sessionId: PlaybackSessionId,
  channelId: string,
  value: number
): void {
  setChannelFilterValue(sessionId, channelId, value);
}

export function addManagedChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effect: EffectConfig
): void {
  addChannelEffect(sessionId, channelId, effect);
}

export function updateManagedChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectId: string,
  effectConfig: Partial<EffectConfig>
): void {
  updateChannelEffect(sessionId, channelId, effectId, effectConfig);
}

export function removeManagedChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectId: string
): void {
  removeChannelEffect(sessionId, channelId, effectId);
}

export function reorderManagedChannelEffects(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectIds: string[]
): void {
  reorderChannelEffects(sessionId, channelId, effectIds);
}
