import { eq, useLiveQuery } from "@tanstack/react-db";
import {
  AudioManager,
  type AudioState,
  type EffectConfig,
  type FilterConfig,
} from "@/lib/audio";
import {
  getPlaybackChannel,
  type PlaybackChannelRecord,
  type PlaybackSessionId,
  playbackSessionsCollection,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";
import {
  getPlaybackChannelRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelPeakLevel,
  setPlaybackChannelRuntime,
  setPlaybackChannelSoundId,
  usePlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { toRuntimeAudioError } from "./playback-action-errors.js";

export type ChannelState = PlaybackChannelRecord &
  ReturnType<typeof getPlaybackChannelRuntime>;

type ChannelAudioField =
  | "volume"
  | "muted"
  | "pan"
  | "speed"
  | "channelFilter"
  | "effectsDryWet"
  | "filter";

type ChannelUpdate =
  | Partial<PlaybackChannelRecord>
  | ((draft: PlaybackChannelRecord) => void);

type ChannelActivationOptions = {
  soundId?: string;
  onAudioState?: (audioState: AudioState) => void;
};

const CHANNEL_AUDIO_SYNC_ORDER = [
  "volume",
  "muted",
  "pan",
  "speed",
  "channelFilter",
  "effectsDryWet",
  "filter",
] as const satisfies readonly ChannelAudioField[];

const subscriptionCleanups = new Map<string, () => void>();

function getAudioManager(): AudioManager {
  return AudioManager.getInstance();
}

function mergeChannelState(
  persisted: PlaybackChannelRecord | undefined,
  runtime: ReturnType<typeof getPlaybackChannelRuntime>
): ChannelState | null {
  if (!persisted) {
    return null;
  }
  return {
    ...persisted,
    ...runtime,
  };
}

function syncChannelAudioField(
  manager: AudioManager,
  soundId: string,
  channel: PlaybackChannelRecord,
  field: ChannelAudioField
): void {
  switch (field) {
    case "volume":
      manager.setVolume(soundId, channel.volume);
      break;
    case "muted":
      if (channel.muted) {
        manager.muteSound(soundId);
      } else {
        manager.unmuteSound(soundId);
      }
      break;
    case "pan":
      manager.setPan(soundId, channel.pan);
      break;
    case "speed":
      manager.setPlaybackRate(soundId, channel.speed);
      break;
    case "channelFilter":
      manager.setChannelFilter(soundId, channel.channelFilter);
      break;
    case "effectsDryWet":
      manager.setEffectsDryWet(soundId, channel.effectsDryWet);
      break;
    case "filter":
      manager.updateFilter(soundId, channel.filter as FilterConfig);
      break;
    default:
      break;
  }
}

function syncChannelAudioFields(
  soundId: string,
  channel: PlaybackChannelRecord,
  fields: readonly ChannelAudioField[]
): void {
  const manager = getAudioManager();
  const selectedFields = new Set<ChannelAudioField>(fields);

  for (const field of CHANNEL_AUDIO_SYNC_ORDER) {
    if (selectedFields.has(field)) {
      syncChannelAudioField(manager, soundId, channel, field);
    }
  }
}

export function getChannelState(
  sessionId: PlaybackSessionId,
  channelId: string
): ChannelState | null {
  return mergeChannelState(
    getPlaybackChannel(sessionId, channelId),
    getPlaybackChannelRuntime(channelId)
  );
}

export function useChannelState(
  sessionId: PlaybackSessionId,
  channelId: string
): ChannelState | null {
  const runtime = usePlaybackChannelRuntime(channelId);
  const result = useLiveQuery((q) =>
    q
      .from({ session: playbackSessionsCollection })
      .where(({ session }) => eq(session.id, sessionId))
  );
  const session = result.data?.[0];
  const persisted = session?.channels.find(
    (channel) => channel.id === channelId
  ) as PlaybackChannelRecord | undefined;
  return mergeChannelState(persisted, runtime);
}

export function updateChannel(
  sessionId: PlaybackSessionId,
  channelId: string,
  update: ChannelUpdate,
  syncFields: readonly ChannelAudioField[] = []
): void {
  updatePlaybackChannel(sessionId, channelId, (draft) => {
    if (typeof update === "function") {
      update(draft);
      return;
    }
    Object.assign(draft, update);
  });

  const channel = getPlaybackChannel(sessionId, channelId);
  const runtime = getPlaybackChannelRuntime(channelId);
  if (!(channel && runtime.soundId && syncFields.length > 0)) {
    return;
  }
  syncChannelAudioFields(runtime.soundId, channel, syncFields);
}

export function setChannelVolume(
  sessionId: PlaybackSessionId,
  channelId: string,
  volume: number
): void {
  updateChannel(sessionId, channelId, { volume }, ["volume"]);
}

export function setChannelMuted(
  sessionId: PlaybackSessionId,
  channelId: string,
  muted: boolean
): void {
  updateChannel(sessionId, channelId, { muted }, ["muted"]);
}

export function setChannelPan(
  sessionId: PlaybackSessionId,
  channelId: string,
  pan: number
): void {
  updateChannel(sessionId, channelId, { pan }, ["pan"]);
}

export function setChannelSpeed(
  sessionId: PlaybackSessionId,
  channelId: string,
  speed: number
): void {
  updateChannel(sessionId, channelId, { speed }, ["speed"]);
}

export function setChannelFilterValue(
  sessionId: PlaybackSessionId,
  channelId: string,
  channelFilter: number
): void {
  updateChannel(sessionId, channelId, { channelFilter }, ["channelFilter"]);
}

export function setChannelEffectsDryWet(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectsDryWet: number
): void {
  updateChannel(sessionId, channelId, { effectsDryWet }, ["effectsDryWet"]);
}

export function updateChannelFilter(
  sessionId: PlaybackSessionId,
  channelId: string,
  filter: FilterConfig
): void {
  updateChannel(sessionId, channelId, { filter }, ["filter"]);
}

export function addChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effect: EffectConfig
): void {
  let orderedEffect = effect;
  updateChannel(sessionId, channelId, (draft) => {
    orderedEffect = {
      ...effect,
      order: draft.effects.length,
    } as EffectConfig;
    draft.effects.push(orderedEffect);
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().addEffect(runtime.soundId, orderedEffect);
  }
}

export function updateChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectId: string,
  effectConfig: Partial<EffectConfig>
): void {
  let effectFound = false;
  updateChannel(sessionId, channelId, (draft) => {
    const effect = draft.effects.find((entry) => entry.id === effectId);
    if (effect) {
      Object.assign(effect, effectConfig);
      effectFound = true;
    }
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (effectFound && runtime.soundId) {
    getAudioManager().updateEffect(runtime.soundId, effectId, effectConfig);
  }
}

export function removeChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectId: string
): void {
  updateChannel(sessionId, channelId, (draft) => {
    draft.effects = draft.effects.filter((effect) => effect.id !== effectId);
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (runtime.soundId) {
    getAudioManager().removeEffect(runtime.soundId, effectId);
  }
}

export function reorderChannelEffects(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectIds: string[]
): void {
  updateChannel(sessionId, channelId, (draft) => {
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

function setChannelSubscriptionCleanup(
  channelId: string,
  cleanup: (() => void) | null
): void {
  subscriptionCleanups.get(channelId)?.();
  if (cleanup) {
    subscriptionCleanups.set(channelId, cleanup);
    return;
  }
  subscriptionCleanups.delete(channelId);
}

export function clearAllChannelSubscriptionCleanups(): void {
  for (const cleanup of subscriptionCleanups.values()) {
    cleanup();
  }
  subscriptionCleanups.clear();
}

export function subscribeChannelRuntime(
  sessionId: PlaybackSessionId,
  channelId: string,
  soundId: string,
  options: Pick<ChannelActivationOptions, "onAudioState"> = {}
): void {
  const manager = getAudioManager();
  const cleanup = manager.subscribe(soundId, (audioState) => {
    const channel = getPlaybackChannel(sessionId, channelId);
    setPlaybackChannelRuntime(channelId, () => ({
      soundId,
      isPlaying: audioState.isPlaying,
      isLoading: audioState.isLoading,
      isBuffering: audioState.isBuffering,
      error: audioState.error
        ? toRuntimeAudioError(
            audioState.error,
            audioState.error.code,
            channel?.radio ?? undefined
          )
        : null,
    }));
    options.onAudioState?.(audioState);
  });

  const meterCleanup =
    sessionId === "dj"
      ? manager.subscribeMeter(soundId, (level) => {
          setPlaybackChannelPeakLevel(channelId, level);
        })
      : null;

  setChannelSubscriptionCleanup(channelId, () => {
    cleanup();
    meterCleanup?.();
  });
}

export function activateChannel(
  sessionId: PlaybackSessionId,
  channelId: string,
  radio: PlaybackChannelRecord["radio"],
  optionsOrSoundId: ChannelActivationOptions | string = {}
): string {
  if (!radio) {
    throw new Error(`Cannot activate ${channelId} without a radio`);
  }

  const options =
    typeof optionsOrSoundId === "string"
      ? { soundId: optionsOrSoundId }
      : optionsOrSoundId;
  const soundId = options.soundId ?? `${sessionId}:${channelId}`;

  deactivateChannel(channelId);
  getAudioManager().createSound(radio, soundId);
  setPlaybackChannelSoundId(channelId, soundId);
  subscribeChannelRuntime(sessionId, channelId, soundId, {
    onAudioState: options.onAudioState,
  });
  return soundId;
}

export function deactivateChannel(channelId: string): void {
  const runtime = getPlaybackChannelRuntime(channelId);
  setChannelSubscriptionCleanup(channelId, null);
  if (runtime.soundId) {
    getAudioManager().cleanupSound(runtime.soundId);
  }
  resetPlaybackChannelRuntime(channelId);
}
