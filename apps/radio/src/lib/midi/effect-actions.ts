import {
  getEffectMidiParamDefs,
  getEffectSchema,
} from "@/lib/audio/dsp/effects/schema";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  findEffectInTree,
  isEffectContainer,
  visitEffectTree,
} from "@/lib/audio/dsp/routing/effect-tree";
import type { ChannelEffectsChange } from "@/lib/channel-effects";
import type { DeckId } from "@/lib/dj-deck";
import type { MidiAction, MidiTargetId } from "./types";

export type EffectChangeFactory = (
  tree: readonly EffectConfig[]
) => ChannelEffectsChange | null;

type EffectActionOptions = {
  change(factory: EffectChangeFactory, coalesceKey?: MidiTargetId): void;
  deckId: DeckId;
  tree: readonly EffectConfig[];
};

export function collectEffectIds(
  effects: readonly EffectConfig[]
): Set<string> {
  const ids = new Set<string>();
  visitEffectTree(effects, ({ id }) => ids.add(id));
  return ids;
}

function collectActions(
  effect: EffectConfig,
  targetPrefix: string,
  group: string,
  change: EffectActionOptions["change"]
): MidiAction[] {
  const schema = getEffectSchema(effect.type);
  if (!schema) {
    return [];
  }
  const actions: MidiAction[] = [
    {
      targetId: `${targetPrefix}:enabled`,
      label: `${schema.name} - Enabled`,
      group,
      type: "button",
      dispatch: () =>
        change((tree) => {
          const current = findEffectInTree(tree, effect.id);
          return current
            ? {
                type: "update",
                effectId: effect.id,
                patch: { enabled: !current.enabled },
              }
            : null;
        }),
    },
  ];

  for (const param of getEffectMidiParamDefs(effect.type)) {
    const targetId = `${targetPrefix}:${param.key}`;
    actions.push({
      targetId,
      label: `${schema.name} - ${param.label}`,
      group,
      type: "continuous",
      dispatch: (value) =>
        change(
          () => ({
            type: "update",
            effectId: effect.id,
            patch: {
              [param.key]: param.min + value * (param.max - param.min),
            },
          }),
          targetId
        ),
      range: { min: param.min, max: param.max, step: param.step },
    });
  }

  if (!isEffectContainer(effect)) {
    return actions;
  }
  for (const chain of effect.chains) {
    const chainPrefix = `${targetPrefix}:chain:${chain.id}`;
    for (const [key, label, min, max, step] of [
      ["gain", "Gain", 0, 4, 0.01],
      ["pan", "Pan", -1, 1, 0.01],
    ] as const) {
      const targetId = `${chainPrefix}:${key}`;
      actions.push({
        targetId,
        label: `${schema.name} - ${chain.name} ${label}`,
        group,
        type: "continuous",
        dispatch: (value) =>
          change(
            () => ({
              type: "update-chain",
              effectId: effect.id,
              chainId: chain.id,
              patch: { [key]: min + value * (max - min) },
            }),
            targetId
          ),
        range: { min, max, step },
      });
    }
    for (const child of chain.effects) {
      actions.push(
        ...collectActions(
          child,
          `${chainPrefix}:effect:${child.id}`,
          group,
          change
        )
      );
    }
  }
  return actions;
}

export function createEffectMidiActions({
  change,
  deckId,
  tree,
}: EffectActionOptions): MidiAction[] {
  return tree.flatMap((effect) =>
    collectActions(
      effect,
      `${deckId}:effect:${effect.id}`,
      `${deckId}-effects`,
      change
    )
  );
}
