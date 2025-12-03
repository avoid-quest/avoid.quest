import type { FilterType as EffectFilterType } from "./effects/types";

export type FilterType = EffectFilterType;

export type FilterConfig = {
  type: EffectFilterType;
  frequency: number;
  Q: number;
  gain: number;
  enabled: boolean;
};
