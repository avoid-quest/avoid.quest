import { getCachedNamModel } from "../dsp/effects/nam-model-store.js";
import {
  convertEffectConfigToEngine,
  convertPartialEffectConfigToEngine,
  type EngineEffectConfig,
} from "../dsp/effects/schema.js";
import type { EffectConfig, EffectType } from "../dsp/effects/types.js";

export type {
  EngineEffectConfig,
  EngineEffectParamValue,
} from "../dsp/effects/schema.js";

function modelAvailable(config: Partial<EffectConfig>): number {
  const model = config as {
    modelData?: string | null;
    modelId?: string | null;
  };
  return model.modelData || getCachedNamModel(model.modelId ?? null) ? 1 : 0;
}

export function convertEffectConfig(config: EffectConfig): EngineEffectConfig {
  const converted = convertEffectConfigToEngine(config);
  if (config.type === "neuralAmp") {
    converted.modelAvailable = modelAvailable(config);
  }
  return converted;
}

export function convertPartialEffectConfig(
  type: EffectType,
  config: Partial<EffectConfig>
): EngineEffectConfig {
  const converted = convertPartialEffectConfigToEngine(type, config);
  if (
    type === "neuralAmp" &&
    ("modelData" in config || "modelId" in config || "modelUrl" in config)
  ) {
    converted.modelAvailable = modelAvailable(config);
  }
  return converted;
}

export function toPlainEffectConfig<
  T extends EffectConfig | Partial<EffectConfig>,
>(config: T): T {
  const plain = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  for (const key of Object.keys(config)) {
    if ((config as Record<string, unknown>)[key] === undefined) {
      plain[key] = undefined;
    }
  }
  return plain as T;
}
