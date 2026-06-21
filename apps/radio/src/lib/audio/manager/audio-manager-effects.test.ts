import { describe, expect, test } from "bun:test";
import { createDefaultEffectConfig } from "../dsp/effects/registry";
import { getEffectParamDefs } from "../dsp/effects/schema";
import type { EffectConfig, EffectType } from "../dsp/effects/types";
import { EFFECT_TYPES } from "../dsp/effects/types";
import {
  convertEffectConfig,
  convertPartialEffectConfig,
} from "./audio-manager-effects";

function readConfigValue(config: EffectConfig, key: string): unknown {
  return (config as unknown as Record<string, unknown>)[key];
}

describe("audio manager effect config conversion", () => {
  test("converts every schema parameter from default configs into worklet params", () => {
    for (const type of EFFECT_TYPES) {
      const config = createDefaultEffectConfig(type, `effect-${type}`, 0);
      const converted = convertEffectConfig(config);

      for (const param of getEffectParamDefs(type)) {
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

  test("converts partial configs using the explicit effect type", () => {
    expect(
      convertPartialEffectConfig("delay", {
        enabled: false,
        dryWet: 0.4,
        delayTime: 0.5,
        feedback: 0.2,
      } as Partial<EffectConfig>)
    ).toEqual({
      enabled: 0,
      wet: 0.4,
      dry: 0.6,
      dryWet: 0.4,
      delayTime: 0.5,
      feedback: 0.2,
    });
  });

  test("does not convert parameters from a different effect type", () => {
    expect(
      convertPartialEffectConfig("delay", {
        delayTime: 0.25,
        threshold: -30,
      } as Partial<EffectConfig>)
    ).toEqual({
      delayTime: 0.25,
    });
  });
});
