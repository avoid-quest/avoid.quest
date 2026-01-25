import type {
  EffectDefinition,
  TransitionDefinition,
  TransitionType,
} from "./types";

const effects = new Map<string, EffectDefinition>();
const transitions = new Map<TransitionType, TransitionDefinition>();

export function registerEffect(effect: EffectDefinition): void {
  effects.set(effect.id, effect);
}

export function registerTransition(transition: TransitionDefinition): void {
  transitions.set(transition.id, transition);
}

export function getEffect(id: string): EffectDefinition | undefined {
  return effects.get(id);
}

export function getTransition(
  id: TransitionType
): TransitionDefinition | undefined {
  return transitions.get(id);
}

export function getAllEffects(): EffectDefinition[] {
  return Array.from(effects.values());
}

export function getAllTransitions(): TransitionDefinition[] {
  return Array.from(transitions.values());
}

export function getEffectsByCategory(
  category: EffectDefinition["category"]
): EffectDefinition[] {
  return getAllEffects().filter((e) => e.category === category);
}
