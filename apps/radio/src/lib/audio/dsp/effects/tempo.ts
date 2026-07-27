export const DEFAULT_EFFECT_TEMPO = 120;
export const MIN_EFFECT_TEMPO = 30;
export const MAX_EFFECT_TEMPO = 1000;

export function clampEffectTempo(value: number): number {
  return Math.max(MIN_EFFECT_TEMPO, Math.min(MAX_EFFECT_TEMPO, value));
}
