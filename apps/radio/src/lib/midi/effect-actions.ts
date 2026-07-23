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
import { getDjDeckActions } from "@/lib/dj-actions";
import { MidiController } from "./midi-controller";
import type { MidiAction } from "./types";

type ContainerEffect = Extract<
  EffectConfig,
  { type: "fxComposite" | "stereoSplit" | "frequencySplit" }
>;

function isContainer(effect: EffectConfig): effect is ContainerEffect {
  return (
    effect.type === "fxComposite" ||
    effect.type === "stereoSplit" ||
    effect.type === "frequencySplit"
  );
}

function updateEffectTree(
  effect: EffectConfig,
  targetId: string,
  update: (effect: EffectConfig) => EffectConfig
): EffectConfig {
  if (effect.id === targetId) {
    return update(effect);
  }
  if (!isContainer(effect)) {
    return effect;
  }
  return {
    ...effect,
    chains: effect.chains.map((chain) => ({
      ...chain,
      effects: chain.effects.map((child) =>
        updateEffectTree(child, targetId, update)
      ),
    })),
  };
}

function collectEffectActions(
  rootEffect: EffectConfig,
  effect: EffectConfig,
  targetPrefix: string,
  group: string,
  updateRoot: (effect: EffectConfig) => void
): MidiAction[] {
  const schema = getEffectSchema(effect.type);
  if (!schema) {
    return [];
  }
  const patch = (config: Partial<EffectConfig>) =>
    updateRoot(
      updateEffectTree(
        rootEffect,
        effect.id,
        (current) =>
          ({
            ...current,
            ...config,
          }) as EffectConfig
      )
    );
  const actions: MidiAction[] = [
    {
      targetId: `${targetPrefix}:enabled`,
      label: `${schema.name} - Enabled`,
      group,
      type: "button",
      dispatch: () => patch({ enabled: !effect.enabled }),
    },
  ];

  for (const param of getEffectMidiParamDefs(effect.type)) {
    actions.push({
      targetId: `${targetPrefix}:${param.key}`,
      label: `${schema.name} - ${param.label}`,
      group,
      type: "continuous",
      dispatch: (value) =>
        patch({
          [param.key]: param.min + value * (param.max - param.min),
        }),
      range: { min: param.min, max: param.max, step: param.step },
    });
  }

  if (isContainer(effect)) {
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
          dispatch: (value) =>
            patch({
              chains: effect.chains.map((item) =>
                item.id === chain.id
                  ? { ...item, [key]: min + value * (max - min) }
                  : item
              ),
            } as Partial<EffectConfig>),
          range: { min, max, step },
        });
      }
      for (const child of chain.effects) {
        actions.push(
          ...collectEffectActions(
            rootEffect,
            child,
            `${chainPrefix}:effect:${child.id}`,
            group,
            updateRoot
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
  const group = `${deckId}-effects`;
  const prefix = `${deckId}:effect:${effect.id}`;
  const actions = collectEffectActions(
    effect,
    effect,
    prefix,
    group,
    (updated) => updateEffect(effect.id, updated)
  );

  return MidiController.getInstance().registerAll(actions);
}
