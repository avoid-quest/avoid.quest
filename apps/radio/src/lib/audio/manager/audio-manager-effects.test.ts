import { describe, expect, test } from "bun:test";
import { createDefaultEffectConfig } from "../dsp/effects/registry";
import {
  EFFECT_SCHEMAS,
  type EffectParamDef,
  type ParamDef,
} from "../dsp/effects/schema";
import type { EffectConfig, EffectType } from "../dsp/effects/types";
import { EFFECT_TYPES } from "../dsp/effects/types";
import { convertEffectConfig } from "./audio-manager-effects";

function collectParamDefs(params: readonly ParamDef[]): EffectParamDef[] {
  const result: EffectParamDef[] = [];

  for (const param of params) {
    if (param.type === "group") {
      result.push(...collectParamDefs(param.children));
    } else {
      result.push(param);
    }
  }

  return result;
}

function readConfigValue(config: EffectConfig, key: string): unknown {
  return (config as unknown as Record<string, unknown>)[key];
}

describe("audio manager effect config conversion", () => {
  test("converts every schema parameter from default configs into worklet params", () => {
    for (const type of EFFECT_TYPES) {
      const config = createDefaultEffectConfig(type, `effect-${type}`, 0);
      const converted = convertEffectConfig(config);
      const paramDefs = collectParamDefs(EFFECT_SCHEMAS[type].params);

      for (const param of paramDefs) {
        const original = readConfigValue(config, param.key);
        const convertedValue = converted[param.key];

        if (param.type === "checkbox") {
          expect(convertedValue).toBe(original ? 1 : 0);
        } else {
          expect(convertedValue).toBe(original as string | number);
        }
      }
    }
  });

  test("converts universal parameters and dryWet split for full configs", () => {
    const config = {
      ...createDefaultEffectConfig("compressor", "compressor-1", 2),
      enabled: true,
      dryWet: 0.25,
      inputGain: 0.8,
      outputGain: 0.7,
      lookahead: false,
      autoAttack: true,
      autoRelease: true,
      autoMakeup: true,
    };

    expect(convertEffectConfig(config)).toEqual({
      enabled: 1,
      inputGain: 0.8,
      outputGain: 0.7,
      wet: 0.25,
      dry: 0.75,
      dryWet: 0.25,
      threshold: -10,
      ratio: 4,
      attack: 2,
      release: 140,
      knee: 6,
      makeup: 0,
      mix: 1,
      lookahead: 0,
      autoAttack: 1,
      autoRelease: 1,
      autoMakeup: 1,
    });
  });

  test("keeps effect ordering out of converted worklet params", () => {
    const config = createDefaultEffectConfig(
      "delay" satisfies EffectType,
      "delay-1",
      12
    );

    expect(convertEffectConfig(config)).not.toHaveProperty("order");
  });
});
