/**
 * Declarative Effect Parameter Schema
 *
 * Compatibility facade for effect definitions, parameter metadata, traversal,
 * and engine conversion helpers.
 */

export { EFFECT_DEFINITIONS, EFFECT_SCHEMAS } from "./effect-definitions.js";
export {
  convertEffectConfigToEngine,
  convertEffectParamValue,
  convertPartialEffectConfigToEngine,
} from "./engine-conversion.js";
export * from "./param-traversal.js";
export * from "./param-types.js";
export {
  EFFECT_PARAMETER_ROLE_MAP,
  type EffectParameterRole,
  UNIVERSAL_EFFECT_PARAMETER_ROLES,
} from "./parameter-roles.js";
export {
  UNIVERSAL_EFFECT_PARAM_DEFS,
  UNIVERSAL_EFFECT_PARAM_KEYS,
} from "./universal-params.js";
