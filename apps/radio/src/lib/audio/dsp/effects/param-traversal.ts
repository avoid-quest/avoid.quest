import { EFFECT_DEFINITIONS } from "./effect-definitions.js";
import type {
  EffectDefaultConfig,
  EffectDefinition,
  EffectParamDef,
  EffectSchema,
  ParamDef,
  SliderParamDef,
} from "./param-types.js";
import type { EffectType } from "./types.js";
import { UNIVERSAL_EFFECT_PARAM_DEFS } from "./universal-params.js";

export function getEffectDefinition(
  type: EffectType
): EffectDefinition | undefined {
  return EFFECT_DEFINITIONS[type];
}

export function getEffectSchema(type: EffectType): EffectSchema | undefined {
  return getEffectDefinition(type);
}

export function getEffectDefaultConfig(
  type: EffectType
): EffectDefaultConfig | undefined {
  return getEffectDefinition(type)?.defaultConfig;
}

export function getEffectParamDefs(type: EffectType): EffectParamDef[] {
  return extractParamDefs(EFFECT_DEFINITIONS[type].params);
}

export function getEffectSliderParamDefs(type: EffectType): SliderParamDef[] {
  return getEffectParamDefs(type).filter(
    (param): param is SliderParamDef => param.type === "slider"
  );
}

export function getEffectMidiParamDefs(type: EffectType): SliderParamDef[] {
  return [...getEffectSliderParamDefs(type), ...UNIVERSAL_EFFECT_PARAM_DEFS];
}

/** Extract all leaf parameter definitions from nested schema groups. */
export function extractParamDefs(
  params: readonly ParamDef[]
): EffectParamDef[] {
  const paramDefs: EffectParamDef[] = [];

  for (const param of params) {
    if (param.type === "group") {
      paramDefs.push(...extractParamDefs(param.children));
    } else {
      paramDefs.push(param);
    }
  }

  return paramDefs;
}
