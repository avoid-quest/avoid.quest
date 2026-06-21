import { getEffectParamDefs } from "./param-traversal.js";
import type {
  EffectParamDef,
  EngineEffectConfig,
  EngineEffectParamValue,
} from "./param-types.js";
import type { EffectConfig, EffectType } from "./types.js";

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
  return;
}

export function convertEffectParamValue(
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
      return;
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

function applyEffectParams(
  result: EngineEffectConfig,
  type: EffectType,
  config: Record<string, unknown>
): void {
  for (const param of getEffectParamDefs(type)) {
    if (config[param.key] === undefined) {
      continue;
    }

    const value = convertEffectParamValue(param, config[param.key]);
    if (value !== undefined) {
      result[param.key] = value;
    }
  }
}

export function convertEffectConfigToEngine(
  config: EffectConfig
): EngineEffectConfig {
  const result: EngineEffectConfig = {};
  const record = effectConfigRecord(config);

  applyUniversalParams(result, record);
  applyEffectParams(result, config.type, record);

  return result;
}

export function convertPartialEffectConfigToEngine(
  type: EffectType,
  config: Partial<EffectConfig>
): EngineEffectConfig {
  const result: EngineEffectConfig = {};
  const record = effectConfigRecord(config);

  applyUniversalParams(result, record);
  applyEffectParams(result, type, record);

  return result;
}
