import { eq, useLiveQuery } from "@tanstack/react-db";
import {
  AudioManager,
  type AudioState,
  type EffectConfig,
  type EffectType,
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
  getPlaybackRuntimeChannelIds,
  resetPlaybackChannelRuntime,
  setPlaybackChannelPeakLevel,
  setPlaybackChannelRuntime,
  setPlaybackChannelSoundId,
  usePlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import {
  appendEffectInOrder,
  createOrderedEffectConfig,
  reorderEffectsByIds,
} from "./effect-order.js";
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

export type ChannelActivationOptions = {
  soundId?: string;
  onAudioState?: (audioState: AudioState) => void;
  persistRadio?: boolean;
};

export type ChannelRuntimeSubscriptionOptions = Pick<
  ChannelActivationOptions,
  "onAudioState"
>;

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
  let orderedEffect: EffectConfig | null = null;
  updateChannel(sessionId, channelId, (draft) => {
    const effects = appendEffectInOrder(draft.effects, effect);
    draft.effects = effects;
    orderedEffect = effects.at(-1) ?? null;
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (orderedEffect && runtime.soundId) {
    getAudioManager().addEffect(runtime.soundId, orderedEffect);
  }
}

export function createAndAddChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  type: EffectType,
  effectId: string
): void {
  const channel = getPlaybackChannel(sessionId, channelId);
  const effect = createOrderedEffectConfig(
    type,
    effectId,
    channel?.effects ?? []
  );
  addChannelEffect(sessionId, channelId, effect);
}

export function updateChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectId: string,
  effectConfig: Partial<EffectConfig>
): void {
  let effectFound = false;
  let effectType: EffectType | null = null;
  updateChannel(sessionId, channelId, (draft) => {
    const effect = draft.effects.find((entry) => entry.id === effectId);
    if (effect) {
      Object.assign(effect, effectConfig);
      effectFound = true;
      effectType = effect.type;
    }
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (effectFound && effectType && runtime.soundId) {
    getAudioManager().updateEffect(
      runtime.soundId,
      effectId,
      effectType,
      effectConfig
    );
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
  let serializedOrder: string[] | null = null;
  updateChannel(sessionId, channelId, (draft) => {
    const effects = reorderEffectsByIds(draft.effects, effectIds);
    draft.effects = effects;
    serializedOrder = effects.map((effect) => effect.id);
  });
  const runtime = getPlaybackChannelRuntime(channelId);
  if (serializedOrder && runtime.soundId) {
    getAudioManager().reorderEffects(runtime.soundId, serializedOrder);
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

export function deactivateAllChannels(): void {
  const channelIds = new Set([
    ...subscriptionCleanups.keys(),
    ...getPlaybackRuntimeChannelIds(),
  ]);

  for (const channelId of channelIds) {
    deactivateChannel(channelId);
  }
}

export function subscribeChannelRuntime(
  sessionId: PlaybackSessionId,
  channelId: string,
  soundId: string,
  options: ChannelRuntimeSubscriptionOptions = {}
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

  let meterCleanup: (() => void) | null = null;
  try {
    meterCleanup =
      sessionId === "dj"
        ? manager.subscribeMeter(soundId, (level) => {
            setPlaybackChannelPeakLevel(channelId, level);
          })
        : null;

    setChannelSubscriptionCleanup(channelId, () => {
      cleanup();
      meterCleanup?.();
    });
  } catch (error) {
    cleanup();
    meterCleanup?.();
    throw error;
  }
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
  const previousRadio = getPlaybackChannel(sessionId, channelId)?.radio ?? null;
  const manager = getAudioManager();
  let soundCreated = false;

  deactivateChannel(channelId);
  try {
    manager.createSound(radio, soundId);
    soundCreated = true;
    if (options.persistRadio) {
      updatePlaybackChannel(sessionId, channelId, (draft) => {
        draft.radio = radio;
      });
    }
    setPlaybackChannelSoundId(channelId, soundId);
    subscribeChannelRuntime(sessionId, channelId, soundId, {
      onAudioState: options.onAudioState,
    });
  } catch (error) {
    setChannelSubscriptionCleanup(channelId, null);
    if (soundCreated) {
      manager.cleanupSound(soundId);
    }
    resetPlaybackChannelRuntime(channelId);
    if (options.persistRadio) {
      updatePlaybackChannel(sessionId, channelId, (draft) => {
        draft.radio = previousRadio;
      });
    }
    throw error;
  }
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
