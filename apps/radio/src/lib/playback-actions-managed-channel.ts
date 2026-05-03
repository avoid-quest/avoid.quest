import type { EffectConfig, FilterConfig } from "@/lib/audio";
import {
  type PlaybackChannelRecord,
  type PlaybackSessionId,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";
import { getAudioManager } from "./playback-actions-shared.js";

export function updateManagedChannel(
  sessionId: PlaybackSessionId,
  channelId: string,
  updater: (draft: PlaybackChannelRecord) => void
): void {
  updatePlaybackChannel(sessionId, channelId, updater);
}

export function updateManagedChannelFilter(
  sessionId: PlaybackSessionId,
  channelId: string,
  filter: FilterConfig
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.filter = filter;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().updateFilter(runtime.soundId, filter);
  }
}

export function setManagedChannelEffectsDryWet(
  sessionId: PlaybackSessionId,
  channelId: string,
  value: number
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.effectsDryWet = value;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().setEffectsDryWet(runtime.soundId, value);
  }
}

export function setManagedChannelPan(
  sessionId: PlaybackSessionId,
  channelId: string,
  pan: number
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.pan = pan;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().setPan(runtime.soundId, pan);
  }
}

export function setManagedChannelSpeed(
  sessionId: PlaybackSessionId,
  channelId: string,
  speed: number
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.speed = speed;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().setPlaybackRate(runtime.soundId, speed);
  }
}

export function setManagedChannelMuted(
  sessionId: PlaybackSessionId,
  channelId: string,
  muted: boolean
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.muted = muted;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    if (muted) {
      getAudioManager().muteSound(runtime.soundId);
    } else {
      getAudioManager().unmuteSound(runtime.soundId);
    }
  }
}

export function setManagedChannelRepeat(
  sessionId: PlaybackSessionId,
  channelId: string,
  repeat: boolean
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.repeat = repeat;
  });
}

export function setManagedChannelAutoplay(
  sessionId: PlaybackSessionId,
  channelId: string,
  autoplay: boolean
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.autoplay = autoplay;
  });
}

export function seekManagedChannel(channelId: string, position: number): void {
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().seekSound(runtime.soundId, position);
  }
}

export function setManagedChannelFilterValue(
  sessionId: PlaybackSessionId,
  channelId: string,
  value: number
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.channelFilter = value;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().setChannelFilter(runtime.soundId, value);
  }
}

export function addManagedChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effect: EffectConfig
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.effects.push(effect);
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().addEffect(runtime.soundId, effect);
  }
}

export function updateManagedChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectId: string,
  effectConfig: Partial<EffectConfig>
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    const effect = draft.effects.find((entry) => entry.id === effectId);
    if (effect) {
      Object.assign(effect, effectConfig);
    }
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().updateEffect(runtime.soundId, effectId, effectConfig);
  }
}

export function removeManagedChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectId: string
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.effects = draft.effects.filter((effect) => effect.id !== effectId);
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().removeEffect(runtime.soundId, effectId);
  }
}

export function reorderManagedChannelEffects(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectIds: string[]
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    draft.effects = effectIds
      .map((effectId) => draft.effects.find((effect) => effect.id === effectId))
      .filter((effect): effect is EffectConfig => Boolean(effect));
    for (const [index, effect] of draft.effects.entries()) {
      effect.order = index;
    }
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().reorderEffects(runtime.soundId, effectIds);
  }
}
