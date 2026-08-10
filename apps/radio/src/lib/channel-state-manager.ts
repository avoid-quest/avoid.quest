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
  getPlaybackSession,
  PLAYBACK_SESSION_IDS,
  type PlaybackChannelRecord,
  type PlaybackSessionId,
  playbackSessionsCollection,
  setPlaybackSessionTempo,
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
  appendEffectToTree,
  findEffectChain,
  findEffectInTree,
  findRootEffectContainer,
  findRootEffectContainerForChain,
  isEffectContainer,
  removeEffectFromTree,
  reorderEffectTreeChain,
  updateEffectInTree,
} from "./audio/dsp/routing/effect-tree.js";
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
const sidechainChannelIntents = new Map<string, string>();

function getAudioManager(): AudioManager {
  return AudioManager.getInstance();
}

function syncRootContainer(soundId: string, root: EffectConfig | null): void {
  if (root && isEffectContainer(root)) {
    getAudioManager().updateEffect(soundId, root.id, root.type, {
      chains: root.chains,
      ...(root.type === "frequencySplit"
        ? { crossoverFrequencies: root.crossoverFrequencies }
        : {}),
    } as Partial<EffectConfig>);
  }
}

function updateChannelEffectTree(
  sessionId: PlaybackSessionId,
  channelId: string,
  update: (effects: EffectConfig[]) => EffectConfig[],
  reconcile: (
    soundId: string,
    effects: readonly EffectConfig[] | undefined
  ) => void
): void {
  updateChannel(sessionId, channelId, (draft) => {
    draft.effects = update(draft.effects);
  });

  const soundId = getPlaybackChannelRuntime(channelId).soundId;
  if (soundId) {
    reconcile(soundId, getPlaybackChannel(sessionId, channelId)?.effects);
  }
}

function findSidechainChannelId(
  effects: readonly EffectConfig[]
): string | null {
  for (const effect of effects) {
    const sidechainChannelId = effect.sidechain?.channelId;
    if (sidechainChannelId) {
      return sidechainChannelId;
    }
    if (isEffectContainer(effect)) {
      for (const chain of effect.chains) {
        const nested = findSidechainChannelId(chain.effects);
        if (nested) {
          return nested;
        }
      }
    }
  }
  return null;
}

function syncEffectSidechain(
  soundId: string,
  effects: readonly EffectConfig[]
): void {
  const channelId = findSidechainChannelId(effects);
  if (!channelId) {
    sidechainChannelIntents.delete(soundId);
    getAudioManager().setEffectsSidechain(soundId, null);
    return;
  }
  sidechainChannelIntents.set(soundId, channelId);
  getAudioManager().setEffectsSidechain(
    soundId,
    getPlaybackChannelRuntime(channelId).soundId
  );
}

function syncAllEffectSidechains(): void {
  const activeSoundIds = new Set<string>();
  for (const sessionId of PLAYBACK_SESSION_IDS) {
    for (const channel of getPlaybackSession(sessionId)?.channels ?? []) {
      const soundId = getPlaybackChannelRuntime(channel.id).soundId;
      if (soundId) {
        activeSoundIds.add(soundId);
        syncEffectSidechain(soundId, channel.effects);
      }
    }
  }
  for (const soundId of sidechainChannelIntents.keys()) {
    if (!activeSoundIds.has(soundId)) {
      sidechainChannelIntents.delete(soundId);
    }
  }
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

export function setSessionEffectsTempo(
  sessionId: PlaybackSessionId,
  tempo: number
): void {
  setPlaybackSessionTempo(sessionId, tempo);
  const bpm = getPlaybackSession(sessionId)?.tempo ?? tempo;
  for (const channel of getPlaybackSession(sessionId)?.channels ?? []) {
    const soundId = getPlaybackChannelRuntime(channel.id).soundId;
    if (soundId) {
      getAudioManager().setEffectsTempo(soundId, bpm);
    }
  }
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
  updateChannelEffectTree(
    sessionId,
    channelId,
    (effects) => {
      const updatedEffects = appendEffectInOrder(effects, effect);
      orderedEffect = updatedEffects.at(-1) ?? null;
      return updatedEffects;
    },
    (soundId, effects) => {
      if (!orderedEffect) {
        return;
      }
      const manager = getAudioManager();
      manager.addEffect(soundId, orderedEffect);
      manager.setEffectsTempo(
        soundId,
        getPlaybackSession(sessionId)?.tempo ?? 120
      );
      syncEffectSidechain(soundId, effects ?? []);
    }
  );
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

export function addChannelEffectToChain(
  sessionId: PlaybackSessionId,
  channelId: string,
  chainId: string,
  effect: EffectConfig
): void {
  updateChannelEffectTree(
    sessionId,
    channelId,
    (effects) => appendEffectToTree(effects, effect, chainId),
    (soundId, effects) => {
      if (!effects) {
        return;
      }
      syncRootContainer(
        soundId,
        findRootEffectContainerForChain(effects, chainId)
      );
      syncEffectSidechain(soundId, effects);
    }
  );
}

export function createAndAddChannelEffectToChain(
  sessionId: PlaybackSessionId,
  channelId: string,
  chainId: string,
  type: EffectType,
  effectId: string
): void {
  const effects = getPlaybackChannel(sessionId, channelId)?.effects ?? [];
  const chain = findEffectChain(effects, chainId);
  if (!chain) {
    throw new Error(`Effect chain not found: ${chainId}`);
  }
  addChannelEffectToChain(
    sessionId,
    channelId,
    chainId,
    createOrderedEffectConfig(type, effectId, chain.effects)
  );
}

export function updateChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectId: string,
  effectConfig: Partial<EffectConfig>
): void {
  let effectFound = false;
  let effectType: EffectType | null = null;
  updateChannelEffectTree(
    sessionId,
    channelId,
    (effects) => {
      const effect = findEffectInTree(effects, effectId);
      if (!effect) {
        return effects;
      }
      effectFound = true;
      effectType = effect.type;
      return updateEffectInTree(effects, effectId, effectConfig);
    },
    (soundId, effects) => {
      if (!(effectFound && effectType)) {
        return;
      }
      const persistedEffects = effects ?? [];
      const root = findRootEffectContainer(persistedEffects, effectId);
      if (root) {
        syncRootContainer(soundId, root);
      } else {
        getAudioManager().updateEffect(
          soundId,
          effectId,
          effectType,
          effectConfig
        );
      }
      syncEffectSidechain(soundId, persistedEffects);
    }
  );
}

export function removeChannelEffect(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectId: string
): void {
  const existingEffects =
    getPlaybackChannel(sessionId, channelId)?.effects ?? [];
  const rootId = findRootEffectContainer(existingEffects, effectId)?.id;
  updateChannelEffectTree(
    sessionId,
    channelId,
    (effects) => removeEffectFromTree(effects, effectId),
    (soundId, effects) => {
      const persistedEffects = effects ?? [];
      const root = rootId
        ? (findEffectInTree(persistedEffects, rootId) ?? null)
        : null;
      if (root) {
        syncRootContainer(soundId, root);
      } else {
        getAudioManager().removeEffect(soundId, effectId);
      }
      syncEffectSidechain(soundId, persistedEffects);
    }
  );
}

export function reorderChannelEffectChain(
  sessionId: PlaybackSessionId,
  channelId: string,
  chainId: string,
  effectIds: string[]
): void {
  updateChannelEffectTree(
    sessionId,
    channelId,
    (effects) => reorderEffectTreeChain(effects, effectIds, chainId),
    (soundId, effects) => {
      if (effects) {
        syncRootContainer(
          soundId,
          findRootEffectContainerForChain(effects, chainId)
        );
      }
    }
  );
}

export function reorderChannelEffects(
  sessionId: PlaybackSessionId,
  channelId: string,
  effectIds: string[]
): void {
  let serializedOrder: string[] | null = null;
  updateChannelEffectTree(
    sessionId,
    channelId,
    (effects) => {
      const reorderedEffects = reorderEffectsByIds(effects, effectIds);
      serializedOrder = reorderedEffects.map((effect) => effect.id);
      return reorderedEffects;
    },
    (soundId) => {
      if (serializedOrder) {
        getAudioManager().reorderEffects(soundId, serializedOrder);
      }
    }
  );
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
    manager.createSound(
      radio,
      soundId,
      sessionId === "single" ? "native" : "audio-graph"
    );
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
    syncAllEffectSidechains();
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
    sidechainChannelIntents.delete(runtime.soundId);
    getAudioManager().cleanupSound(runtime.soundId);
  }
  resetPlaybackChannelRuntime(channelId);
  syncAllEffectSidechains();
}
