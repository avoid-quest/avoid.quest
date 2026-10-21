/**
 * Declarative Effect Parameter Schema
 *
 * Compatibility facade for effect definitions, parameter metadata, traversal,
 * and engine conversion helpers.
 */

export { EFFECT_DEFINITIONS } from "./effect-definitions.js";
export {
  convertEffectConfigToEngine,
  convertPartialEffectConfigToEngine,
} from "./engine-conversion.js";
export * from "./param-traversal.js";
export * from "./param-types.js";
export { UNIVERSAL_EFFECT_PARAM_DEFS } from "./universal-params.js";
