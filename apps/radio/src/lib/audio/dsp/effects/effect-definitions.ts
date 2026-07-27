import { CONTAINER_EFFECT_DEFINITIONS } from "./effect-definitions-containers.js";
import { DYNAMICS_EFFECT_DEFINITIONS } from "./effect-definitions-dynamics.js";
import { TIME_SPACE_EFFECT_DEFINITIONS } from "./effect-definitions-time-space.js";
import { TONE_EFFECT_DEFINITIONS } from "./effect-definitions-tone.js";
import type { EffectDefinitionMap } from "./param-types.js";

export const EFFECT_DEFINITIONS = {
  ...TIME_SPACE_EFFECT_DEFINITIONS,
  ...DYNAMICS_EFFECT_DEFINITIONS,
  ...TONE_EFFECT_DEFINITIONS,
  ...CONTAINER_EFFECT_DEFINITIONS,
} as const satisfies EffectDefinitionMap;

export const EFFECT_SCHEMAS = EFFECT_DEFINITIONS;
