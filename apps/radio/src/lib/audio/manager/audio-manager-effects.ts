import {
  convertPartialEffectConfigToEngine,
  type EngineEffectConfig,
} from "../dsp/effects/schema.js";
import type { EffectConfig, EffectType } from "../dsp/effects/types.js";

export type {
  EngineEffectConfig,
  EngineEffectParamValue,
} from "../dsp/effects/schema.js";
export { convertEffectConfigToEngine as convertEffectConfig } from "../dsp/effects/schema.js";

export function convertPartialEffectConfig(
  type: EffectType,
  config: Partial<EffectConfig>
): EngineEffectConfig {
  return convertPartialEffectConfigToEngine(type, config);
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
