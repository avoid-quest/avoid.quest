import { createDefaultEffectConfig } from "@/lib/audio/dsp/effects/registry";
import type { EffectConfig, EffectType } from "@/lib/audio/dsp/effects/types";

function sortByPersistedOrder(
  effects: readonly EffectConfig[]
): EffectConfig[] {
  return [...effects].sort((left, right) => left.order - right.order);
}

function assignSequentialOrder(
  effects: readonly EffectConfig[]
): EffectConfig[] {
  return effects.map(
    (effect, index) =>
      ({
        ...effect,
        order: index,
      }) as EffectConfig
  );
}

export function orderEffectsForPlayback(
  effects: readonly EffectConfig[]
): EffectConfig[] {
  return assignSequentialOrder(sortByPersistedOrder(effects));
}

export function createOrderedEffectConfig(
  type: EffectType,
  id: string,
  currentEffects: readonly EffectConfig[]
): EffectConfig {
  return createDefaultEffectConfig(type, id, currentEffects.length);
}

export function appendEffectInOrder(
  effects: readonly EffectConfig[],
  effect: EffectConfig
): EffectConfig[] {
  return [
    ...orderEffectsForPlayback(effects),
    {
      ...effect,
      order: effects.length,
    } as EffectConfig,
  ];
}

export function reorderEffectsByIds(
  effects: readonly EffectConfig[],
  effectIds: readonly string[]
): EffectConfig[] {
  const orderedEffects = orderEffectsForPlayback(effects);
  const effectsById = new Map(
    orderedEffects.map((effect) => [effect.id, effect] as const)
  );
  const selectedIds = new Set<string>();
  const reorderedEffects: EffectConfig[] = [];

  for (const effectId of effectIds) {
    const effect = effectsById.get(effectId);
    if (effect && !selectedIds.has(effectId)) {
      selectedIds.add(effectId);
      reorderedEffects.push(effect);
    }
  }

  for (const effect of orderedEffects) {
    if (!selectedIds.has(effect.id)) {
      reorderedEffects.push(effect);
    }
  }

  return assignSequentialOrder(reorderedEffects);
}

export function serializeEffectOrder(
  effects: readonly EffectConfig[]
): string[] {
  return orderEffectsForPlayback(effects).map((effect) => effect.id);
}
