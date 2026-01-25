import type { Filter } from "pixi.js";

export type TransitionType = "none" | "fade" | "wipe-h" | "wipe-v";

export type EffectCategory = "transition" | "static" | "analysis";

export type EffectParameter = {
  name: string;
  label: string;
  type: "number" | "boolean" | "select";
  min?: number;
  max?: number;
  step?: number;
  default: number | boolean | string;
  options?: Array<{ label: string; value: string }>;
};

export type EffectDefinition = {
  id: string;
  name: string;
  category: EffectCategory;
  description: string;
  parameters: EffectParameter[];
  createFilter: (params: Record<string, unknown>) => Filter;
};

export type TransitionDefinition = {
  id: TransitionType;
  name: string;
  description: string;
  parameters: EffectParameter[];
  /**
   * Create a filter that blends between two textures
   * @param progress - Transition progress from 0 (showing "from") to 1 (showing "to")
   */
  createFilter: (params: Record<string, unknown>) => Filter;
};

export type ScrollState = {
  currentIndex: number;
  prevIndex: number;
  nextIndex: number;
  progress: number; // 0.0 to 1.0 between images
  direction: "forward" | "backward" | "idle";
};

export type EffectSettings = {
  enabled: boolean;
  transitionType: TransitionType;
  staticEffects: string[];
  parameters: Record<string, Record<string, unknown>>;
};

export const DEFAULT_EFFECT_SETTINGS: EffectSettings = {
  enabled: false,
  transitionType: "fade",
  staticEffects: [],
  parameters: {},
};
