import {
  type EffectParamDef,
  getEffectParamDefs,
} from "../dsp/effects/schema.js";
import {
  EFFECT_TYPES,
  type EffectConfig,
  type EffectType,
} from "../dsp/effects/types.js";

type EngineEffectParamValue = number | string;
type EngineEffectConfig = Record<string, EngineEffectParamValue>;

const UNIVERSAL_EFFECT_PARAM_KEYS = new Set([
  "enabled",
  "dryWet",
  "inputGain",
  "outputGain",
]);

const KNOWN_EFFECT_PARAM_KEYS = new Set<string>();

function effectConfigRecord(
  config: EffectConfig | Partial<EffectConfig>
): Record<string, unknown> {
  return config as Record<string, unknown>;
}

function convertBoolean(value: unknown): number | undefined {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "number") {
    return value === 0 ? 0 : 1;
  }
  return undefined;
}

function convertParamValue(
  param: EffectParamDef,
  value: unknown
): EngineEffectParamValue | undefined {
  switch (param.type) {
    case "checkbox":
      return convertBoolean(value);
    case "slider":
      return typeof value === "number" ? value : undefined;
    case "select":
      if (param.valueType === "number") {
        return typeof value === "number" ? value : undefined;
      }
      return typeof value === "string" ? value : undefined;
    default:
      return undefined;
  }
}

function applyUniversalParams(
  result: EngineEffectConfig,
  config: Record<string, unknown>
): void {
  if (config.enabled !== undefined) {
    const enabled = convertBoolean(config.enabled);
    if (enabled !== undefined) {
      result.enabled = enabled;
    }
  }

  if (typeof config.inputGain === "number") {
    result.inputGain = config.inputGain;
  }

  if (typeof config.outputGain === "number") {
    result.outputGain = config.outputGain;
  }

  if (typeof config.dryWet === "number") {
    result.wet = config.dryWet;
    result.dry = 1 - config.dryWet;
    result.dryWet = config.dryWet;
  }
}

function applySchemaParams(
  result: EngineEffectConfig,
  type: EffectType,
  config: Record<string, unknown>
): void {
  for (const param of getEffectParamDefs(type)) {
    if (config[param.key] === undefined) {
      continue;
    }

    const value = convertParamValue(param, config[param.key]);
    if (value !== undefined) {
      result[param.key] = value;
    }
  }
}

function getKnownEffectParamKeys(): Set<string> {
  if (KNOWN_EFFECT_PARAM_KEYS.size > 0) {
    return KNOWN_EFFECT_PARAM_KEYS;
  }

  for (const type of EFFECT_TYPES) {
    for (const param of getEffectParamDefs(type)) {
      KNOWN_EFFECT_PARAM_KEYS.add(param.key);
    }
  }

  return KNOWN_EFFECT_PARAM_KEYS;
}

function convertEffectConfig(config: EffectConfig): EngineEffectConfig {
  const result: EngineEffectConfig = {};
  const record = effectConfigRecord(config);

  applyUniversalParams(result, record);
  applySchemaParams(result, config.type, record);

  return result;
}

function convertPartialEffectConfig(
  config: Partial<EffectConfig>
): EngineEffectConfig {
  const result: EngineEffectConfig = {};
  const record = effectConfigRecord(config);

  applyUniversalParams(result, record);

  if (config.type) {
    applySchemaParams(result, config.type, record);
    return result;
  }

  const knownParamKeys = getKnownEffectParamKeys();
  for (const [key, value] of Object.entries(record)) {
    if (UNIVERSAL_EFFECT_PARAM_KEYS.has(key) || !knownParamKeys.has(key)) {
      continue;
    }

    if (typeof value === "number" || typeof value === "string") {
      result[key] = value;
    } else if (typeof value === "boolean") {
      result[key] = value ? 1 : 0;
    }
  }

  return result;
}

export { convertEffectConfig, convertPartialEffectConfig };
export type { EngineEffectConfig, EngineEffectParamValue };
