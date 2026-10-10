import { ValueMapping } from "@opendaw/lib-std";
import { scaleMapping, sliderScale } from "@/lib/audio/dsp/effects/param-scale";
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
  change: (factory: EffectChangeFactory, coalesceKey?: MidiTargetId) => void;
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
      dispatch: () =>
        change((tree) => {
          const current = findEffectInTree(tree, effect.id);
          return current
            ? {
                effectId: effect.id,
                patch: { enabled: !current.enabled },
                type: "update",
              }
            : null;
        }),
      group,
      label: `${schema.name} - Enabled`,
      targetId: `${targetPrefix}:enabled`,
      type: "button",
    },
  ];

  for (const param of getEffectMidiParamDefs(effect.type)) {
    const targetId = `${targetPrefix}:${param.key}`;
    const mapping = scaleMapping(param.min, param.max, sliderScale(param));
    actions.push({
      dispatch: (value) =>
        change(
          () => ({
            effectId: effect.id,
            patch: { [param.key]: mapping.y(value) },
            type: "update",
          }),
          targetId
        ),
      group,
      label: `${schema.name} - ${param.label}`,
      range: { max: param.max, min: param.min, step: param.step },
      targetId,
      type: "continuous",
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
      const mapping = ValueMapping.linear(min, max);
      actions.push({
        dispatch: (value) =>
          change(
            () => ({
              chainId: chain.id,
              effectId: effect.id,
              patch: { [key]: mapping.y(value) },
              type: "update-chain",
            }),
            targetId
          ),
        group,
        label: `${schema.name} - ${chain.name} ${label}`,
        range: { max, min, step },
        targetId,
        type: "continuous",
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
