/**
 * Dynamic Effect MIDI Actions
 *
 * Registers MIDI actions for effect parameters based on effect schemas.
 */

import type { EffectConfig } from "@/lib/audio";
import {
  getEffectMidiParamDefs,
  getEffectSchema,
} from "@/lib/audio/dsp/effects/schema";
import {
  findEffectInTree,
  isEffectContainer,
  visitEffectTree,
} from "@/lib/audio/dsp/routing/effect-tree";
import { getPlaybackChannel } from "@/lib/collections/playback-sessions";
import { getDjDeckActions } from "@/lib/dj-actions";
import { MidiController } from "./midi-controller";
import type { MidiAction } from "./types";

export function collectEffectIds(
  effects: readonly EffectConfig[]
): Set<string> {
  const ids = new Set<string>();
  visitEffectTree(effects, ({ id }) => ids.add(id));
  return ids;
}

export function collectEffectActions(
  effect: EffectConfig,
  targetPrefix: string,
  group: string,
  getEffect: (effectId: string) => EffectConfig | undefined,
  updateEffect: (effectId: string, effectConfig: Partial<EffectConfig>) => void
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
        updateEffect(effect.id, {
          enabled: !(getEffect(effect.id)?.enabled ?? effect.enabled),
        }),
    },
  ];

  for (const param of getEffectMidiParamDefs(effect.type)) {
    actions.push({
      targetId: `${targetPrefix}:${param.key}`,
      label: `${schema.name} - ${param.label}`,
      group,
      type: "continuous",
      dispatch: (value) =>
        updateEffect(effect.id, {
          [param.key]: param.min + value * (param.max - param.min),
        }),
      range: { min: param.min, max: param.max, step: param.step },
    });
  }

  if (isEffectContainer(effect)) {
    for (const chain of effect.chains) {
      const chainPrefix = `${targetPrefix}:chain:${chain.id}`;
      for (const [key, label, min, max, step] of [
        ["gain", "Gain", 0, 4, 0.01],
        ["pan", "Pan", -1, 1, 0.01],
      ] as const) {
        actions.push({
          targetId: `${chainPrefix}:${key}`,
          label: `${schema.name} - ${chain.name} ${label}`,
          group,
          type: "continuous",
          dispatch: (value) => {
            const current = getEffect(effect.id);
            if (!(current && isEffectContainer(current))) {
              return;
            }
            updateEffect(effect.id, {
              chains: current.chains.map((item) =>
                item.id === chain.id
                  ? { ...item, [key]: min + value * (max - min) }
                  : item
              ),
            } as Partial<EffectConfig>);
          },
          range: { min, max, step },
        });
      }
      for (const child of chain.effects) {
        actions.push(
          ...collectEffectActions(
            child,
            `${chainPrefix}:effect:${child.id}`,
            group,
            getEffect,
            updateEffect
          )
        );
      }
    }
  }

  return actions;
}

/**
 * Register MIDI actions for a single effect instance on a deck.
 * Returns an unregister function.
 */
export function registerEffectActions(
  deckId: "deck-a" | "deck-b",
  effect: EffectConfig
): () => void {
  const schema = getEffectSchema(effect.type);
  if (!schema) {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op cleanup
    return () => {};
  }

  const { updateEffect } = getDjDeckActions(deckId);
  const getEffect = (effectId: string) =>
    findEffectInTree(getPlaybackChannel("dj", deckId)?.effects ?? [], effectId);
  const group = `${deckId}-effects`;
  const prefix = `${deckId}:effect:${effect.id}`;
  const actions = collectEffectActions(
    effect,
    prefix,
    group,
    getEffect,
    updateEffect
  );

  return MidiController.getInstance().registerAll(actions);
}
