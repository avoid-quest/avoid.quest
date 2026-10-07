import { captureError } from "@avoid.quest/error";
import type { EffectsFallbackCause } from "@/lib/audio/dsp/effects/official-opendaw-mapping";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  appendEffectToTree,
  audibleSidechainIds,
  findEffectInTree,
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
  /** Why it runs on the compatibility engine, while it does. */
  fallback?: EffectsFallbackCause;
};

export type ChannelEffectsResult = {
  desired: DesiredEffectsState;
  runtime: EffectsRuntimeOutcome;
};

export type ChannelEffects = {
  bind: (
    ref: ChannelEffectsRef,
    soundId: string
  ) => Promise<ChannelEffectsResult>;
  change: (
    ref: ChannelEffectsRef,
    change: ChannelEffectsChange
  ) => Promise<ChannelEffectsResult>;
  setTempo: (
    sessionId: PlaybackSessionId,
    bpm: number
  ) => Promise<ChannelEffectsResult[]>;
  unbind: (ref: ChannelEffectsRef) => void;
};

type EffectsRuntime = {
  reconcile: (
    soundId: string,
    desired: DesiredEffectsState
  ) => Promise<EffectsRuntimeOutcome>;
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

/** The channel an enabled, audible effect keys from, if any. */
export function findSidechainChannelId(
  tree: readonly EffectConfig[]
): string | null {
  return audibleSidechainIds(tree)[0] ?? null;
}

/**
 * The tree with each key's channel replaced by the sound it plays on, so the
 * runtime binds each keyed effect by sound id; a key whose channel has no
 * sound keys nothing.
 */
function keyedFromSounds(
  tree: readonly EffectConfig[],
  soundOf: (channelId: string) => string | undefined
): EffectConfig[] {
  return tree.map((effect) => {
    const { sidechain, ...rest } = effect;
    const soundId = sidechain && soundOf(sidechain.channelId);
    const keyed = (
      soundId ? { ...rest, sidechain: { channelId: soundId } } : rest
    ) as EffectConfig;
    return isEffectContainer(keyed)
      ? ({
          ...keyed,
          chains: keyed.chains.map((chain) => ({
            ...chain,
            effects: keyedFromSounds(chain.effects, soundOf),
          })),
        } as EffectConfig)
      : keyed;
  });
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
    // Each keyed effect names the sound its channel is bound to now.
    const tree = keyedFromSounds(normalizeEffectTree(channel.effects), (id) =>
      bindings.get(refKey({ ...ref, channelId: id }))
    );
    return {
      dryWet: Math.max(0, Math.min(1, channel.effectsDryWet)),
      sidechainSoundId: findSidechainChannelId(tree),
      tempo: getPlaybackSession(ref.sessionId)?.tempo ?? 120,
      tree,
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
    const excludedKey = except ? refKey(except) : null;
    return await Promise.all(
      [...bindings.keys()]
        .filter((key) => key !== excludedKey)
        .map((key) => {
          const separator = key.indexOf(":");
          return reconcile({
            channelId: key.slice(separator + 1),
            sessionId: key.slice(0, separator) as PlaybackSessionId,
          });
        })
    );
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
      return await Promise.all(
        [...bindings.keys()]
          .filter((key) => key.startsWith(`${sessionId}:`))
          .map((key) =>
            reconcile({
              channelId: key.slice(sessionId.length + 1),
              sessionId,
            })
          )
      );
    },
    unbind(ref) {
      bindings.delete(refKey(ref));
      reconcileBound().catch((error: unknown) =>
        captureError(error, { operation: "rebindSidechains", surface: "ui" })
      );
    },
  };
}

export const channelEffects = createChannelEffects();
