import type { EffectConfig } from "../dsp/effects/types.js";

const DRY_WET_BYPASS_THRESHOLD = 0.001;

export function hasActiveEffects(effects: Iterable<EffectConfig>): boolean {
  for (const effect of effects) {
    if (effect.enabled !== false) {
      return true;
    }
  }
  return false;
}

export function shouldUseWorkletProcessing(input: {
  effects: Iterable<EffectConfig>;
  effectsDryWet: number;
}): boolean {
  if (input.effectsDryWet <= DRY_WET_BYPASS_THRESHOLD) {
    return false;
  }

  return hasActiveEffects(input.effects);
}
