import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  appendEffectToTree,
  findEffectInTree,
  isEffectChainActive,
  isEffectContainer,
  normalizeEffectTree,
  removeEffectFromTree,
  reorderEffectTreeChain,
  updateEffectInTree,
} from "@/lib/audio/dsp/routing/effect-tree";
import { AudioManager } from "@/lib/audio/manager/audio-manager";
import {
  getPlaybackChannel,
  getPlaybackSession,
  type PlaybackSessionId,
  setPlaybackSessionTempo,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";

export type ChannelEffectsRef = {
  sessionId: PlaybackSessionId;
  channelId: string;
};

export type ChannelEffectsChange =
  | { type: "add"; effect: EffectConfig; chainId?: string }
  | { type: "update"; effectId: string; patch: Partial<EffectConfig> }
  | {
      type: "update-chain";
      effectId: string;
      chainId: string;
      patch: { gain?: number; pan?: number };
    }
  | { type: "remove"; effectId: string }
  | { type: "reorder"; effectIds: string[]; chainId?: string }
  | { type: "replace"; tree: readonly EffectConfig[] }
  | { type: "set-dry-wet"; value: number };

export type DesiredEffectsState = {
  tree: readonly EffectConfig[];
  dryWet: number;
  tempo: number;
  sidechainSoundId: string | null;
};

export type EffectsRuntimeOutcome = {
  backend: "bypass" | "compatibility" | "official" | null;
  ready: boolean;
  status: "failed" | "inactive" | "ready" | "superseded";
  error?: Error;
};

export type ChannelEffectsResult = {
  desired: DesiredEffectsState;
  runtime: EffectsRuntimeOutcome;
};

export type ChannelEffects = {
  bind(ref: ChannelEffectsRef, soundId: string): Promise<ChannelEffectsResult>;
  change(
    ref: ChannelEffectsRef,
    change: ChannelEffectsChange
  ): Promise<ChannelEffectsResult>;
  setTempo(
    sessionId: PlaybackSessionId,
    bpm: number
  ): Promise<ChannelEffectsResult[]>;
  unbind(ref: ChannelEffectsRef): void;
};

type EffectsRuntime = {
  reconcile(
    soundId: string,
    desired: DesiredEffectsState
  ): Promise<EffectsRuntimeOutcome>;
};

type ChannelEffectsOptions = {
  runtime?: EffectsRuntime;
};

const inactiveOutcome = (): EffectsRuntimeOutcome => ({
  backend: null,
  ready: false,
  status: "inactive",
});

const refKey = ({ sessionId, channelId }: ChannelEffectsRef): string =>
  `${sessionId}:${channelId}`;

function findSidechainChannelId(tree: readonly EffectConfig[]): string | null {
  for (const effect of tree) {
    if (!effect.enabled) {
      continue;
    }
    if (effect.sidechain?.channelId) {
      return effect.sidechain.channelId;
    }
    if (isEffectContainer(effect)) {
      const hasSolo = effect.chains.some((chain) => chain.solo);
      const nested = findSidechainChannelId(
        effect.chains.flatMap((chain) =>
          chain.gain !== 0 && isEffectChainActive(chain, hasSolo)
            ? chain.effects
            : []
        )
      );
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

export function createChannelEffects({
  runtime,
}: ChannelEffectsOptions = {}): ChannelEffects {
  const bindings = new Map<string, string>();
  const selectedRuntime: EffectsRuntime =
    runtime ??
    ({
      reconcile: (soundId, desired) =>
        AudioManager.getInstance().reconcileEffects(soundId, desired),
    } satisfies EffectsRuntime);

  const desiredState = (ref: ChannelEffectsRef): DesiredEffectsState => {
    const channel = getPlaybackChannel(ref.sessionId, ref.channelId);
    if (!channel) {
      throw new Error(
        `Playback channel not found: ${ref.sessionId}/${ref.channelId}`
      );
    }
    const sidechainChannelId = findSidechainChannelId(channel.effects);
    return {
      tree: normalizeEffectTree(channel.effects),
      dryWet: Math.max(0, Math.min(1, channel.effectsDryWet)),
      tempo: getPlaybackSession(ref.sessionId)?.tempo ?? 120,
      sidechainSoundId: sidechainChannelId
        ? (bindings.get(refKey({ ...ref, channelId: sidechainChannelId })) ??
          null)
        : null,
    };
  };

  const reconcile = async (
    ref: ChannelEffectsRef
  ): Promise<ChannelEffectsResult> => {
    const desired = desiredState(ref);
    const soundId = bindings.get(refKey(ref));
    return {
      desired,
      runtime: soundId
        ? await selectedRuntime.reconcile(soundId, desired)
        : inactiveOutcome(),
    };
  };

  const reconcileBound = async (
    except?: ChannelEffectsRef
  ): Promise<ChannelEffectsResult[]> => {
    const results: ChannelEffectsResult[] = [];
    for (const key of bindings.keys()) {
      const separator = key.indexOf(":");
      const ref = {
        sessionId: key.slice(0, separator) as PlaybackSessionId,
        channelId: key.slice(separator + 1),
      };
      if (except && refKey(except) === key) {
        continue;
      }
      results.push(await reconcile(ref));
    }
    return results;
  };

  return {
    async bind(ref, soundId) {
      bindings.set(refKey(ref), soundId);
      const result = await reconcile(ref);
      await reconcileBound(ref);
      return result;
    },
    change(ref, change) {
      updatePlaybackChannel(ref.sessionId, ref.channelId, (draft) => {
        switch (change.type) {
          case "add":
            draft.effects = appendEffectToTree(
              draft.effects,
              change.effect,
              change.chainId ?? null
            );
            break;
          case "update":
            if (findEffectInTree(draft.effects, change.effectId)) {
              draft.effects = normalizeEffectTree(
                updateEffectInTree(draft.effects, change.effectId, change.patch)
              );
            }
            break;
          case "update-chain": {
            const effect = findEffectInTree(draft.effects, change.effectId);
            if (!(effect && isEffectContainer(effect))) {
              break;
            }
            draft.effects = normalizeEffectTree(
              updateEffectInTree(draft.effects, change.effectId, {
                chains: effect.chains.map((chain) =>
                  chain.id === change.chainId
                    ? {
                        ...chain,
                        gain:
                          change.patch.gain === undefined
                            ? chain.gain
                            : Math.max(0, Math.min(4, change.patch.gain)),
                        pan:
                          change.patch.pan === undefined
                            ? chain.pan
                            : Math.max(-1, Math.min(1, change.patch.pan)),
                      }
                    : chain
                ),
              } as Partial<EffectConfig>)
            );
            break;
          }
          case "remove":
            draft.effects = removeEffectFromTree(
              draft.effects,
              change.effectId
            );
            break;
          case "reorder":
            draft.effects = reorderEffectTreeChain(
              draft.effects,
              change.effectIds,
              change.chainId ?? null
            );
            break;
          case "replace":
            draft.effects = normalizeEffectTree(change.tree);
            break;
          case "set-dry-wet":
            draft.effectsDryWet = Math.max(0, Math.min(1, change.value));
            break;
          default: {
            const exhaustive: never = change;
            return exhaustive;
          }
        }
      });
      return reconcile(ref);
    },
    async setTempo(sessionId, bpm) {
      setPlaybackSessionTempo(sessionId, bpm);
      const results: ChannelEffectsResult[] = [];
      for (const key of bindings.keys()) {
        if (!key.startsWith(`${sessionId}:`)) {
          continue;
        }
        results.push(
          await reconcile({
            sessionId,
            channelId: key.slice(sessionId.length + 1),
          })
        );
      }
      return results;
    },
    unbind(ref) {
      bindings.delete(refKey(ref));
      reconcileBound().catch((error: unknown) =>
        console.warn("[ChannelEffects] Could not rebind sidechains", error)
      );
    },
  };
}

export const channelEffects = createChannelEffects();
