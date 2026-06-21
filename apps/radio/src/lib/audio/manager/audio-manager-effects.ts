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
