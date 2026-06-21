import { describe, expect, test } from "bun:test";
import { AVAILABLE_EFFECTS } from "./registry";
import {
  convertEffectConfigToEngine,
  EFFECT_DEFINITIONS,
  getEffectDefaultConfig,
  getEffectMidiParamDefs,
  UNIVERSAL_EFFECT_PARAM_DEFS,
} from "./schema";
import type { CompressorConfig, EffectConfig } from "./types";
import { EFFECT_TYPES } from "./types";

describe("effect definitions", () => {
  test("pair each effect with its defaults in the deep definition", () => {
    for (const type of EFFECT_TYPES) {
      const definition = EFFECT_DEFINITIONS[type];

      expect(definition.type).toBe(type);
      expect(definition.defaultConfig.type).toBe(type);
      expect(getEffectDefaultConfig(type)).toBe(definition.defaultConfig);
    }
  });

  test("derive available effect metadata from deep definitions", () => {
    for (const effect of AVAILABLE_EFFECTS) {
      const definition = EFFECT_DEFINITIONS[effect.type];

      expect(effect.name).toBe(definition.name);
      expect(effect.description).toBe(definition.description);
      expect(effect.defaultConfig).toBe(definition.defaultConfig);
    }
  });

  test("expose MIDI sliders with effect params followed by universal params", () => {
    const universalKeys = UNIVERSAL_EFFECT_PARAM_DEFS.map((param) => param.key);

    for (const type of EFFECT_TYPES) {
      const midiKeys = getEffectMidiParamDefs(type).map((param) => param.key);

      expect(midiKeys.slice(-universalKeys.length)).toEqual(universalKeys);
      expect(midiKeys).toContain("dryWet");
      expect(midiKeys).toContain("inputGain");
      expect(midiKeys).toContain("outputGain");
    }
  });

  test("converts engine params through the definition metadata", () => {
    const config = {
      ...EFFECT_DEFINITIONS.compressor.defaultConfig,
      id: "compressor-1",
      order: 0,
      enabled: true,
      lookahead: false,
      autoAttack: true,
    } satisfies CompressorConfig;

    expect(convertEffectConfigToEngine(config)).toMatchObject({
      enabled: 1,
      dryWet: 1,
      wet: 1,
      dry: 0,
      threshold: -10,
      ratio: 4,
      lookahead: 0,
      autoAttack: 1,
    });
    expect(convertEffectConfigToEngine(config)).not.toHaveProperty("id");
    expect(convertEffectConfigToEngine(config)).not.toHaveProperty("order");
  });

  test("keeps serialized defaults compatible with effect configs", () => {
    for (const type of EFFECT_TYPES) {
      const config = {
        ...EFFECT_DEFINITIONS[type].defaultConfig,
        id: `effect-${type}`,
        order: 0,
      } as EffectConfig;

      expect(config.type).toBe(type);
      expect(config.id).toBe(`effect-${type}`);
      expect(config.order).toBe(0);
    }
  });
});
