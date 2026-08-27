import { describe, expect, test } from "bun:test";
import { AVAILABLE_EFFECTS, createDefaultEffectConfig } from "./registry";
import {
  convertEffectConfigToEngine,
  convertPartialEffectConfigToEngine,
  EFFECT_DEFINITIONS,
  getEffectDefaultConfig,
  getEffectMidiParamDefs,
  getEffectParamDefs,
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

  test("keeps every declared parameter unique and backed by a default field", () => {
    for (const type of EFFECT_TYPES) {
      const defaults = EFFECT_DEFINITIONS[type].defaultConfig as Record<
        string,
        unknown
      >;
      const keys = getEffectParamDefs(type).map((param) => param.key);

      expect(new Set(keys)).toHaveLength(keys.length);
      for (const key of keys) {
        expect(defaults).toHaveProperty(key);
      }
    }
  });

  test("converts engine params through the definition metadata", () => {
    const config = {
      ...EFFECT_DEFINITIONS.compressor.defaultConfig,
      autoAttack: true,
      enabled: true,
      id: "compressor-1",
      lookahead: false,
      order: 0,
    } satisfies CompressorConfig;

    expect(convertEffectConfigToEngine(config)).toMatchObject({
      autoAttack: 1,
      dryWet: 1,
      enabled: 1,
      lookahead: 0,
      ratio: 4,
      threshold: -10,
    });
    expect(convertEffectConfigToEngine(config)).not.toHaveProperty("wet");
    expect(convertEffectConfigToEngine(config)).not.toHaveProperty("dry");
    expect(convertEffectConfigToEngine(config)).not.toHaveProperty("id");
    expect(convertEffectConfigToEngine(config)).not.toHaveProperty("order");
  });

  test("converts partial engine params through an explicit effect type", () => {
    expect(
      convertPartialEffectConfigToEngine("delay", {
        delayTime: 0.25,
        threshold: -30,
      } as Partial<EffectConfig>)
    ).toEqual({
      delayTime: 0.25,
    });
  });

  test("marks compatibility containers when a nested effect uses a sidechain", () => {
    const config = createDefaultEffectConfig("fxComposite", "fx", 0);
    const gate = createDefaultEffectConfig("gate", "gate", 0);
    gate.sidechain = { channelId: "deck-b" };
    const [firstChain] = config.chains;
    if (!firstChain) {
      throw new Error("Default composite must contain a chain");
    }
    firstChain.effects = [gate];

    expect(convertEffectConfigToEngine(config).sidechainEnabled).toBe(1);
  });

  test("passes client-side script and model references through text params", () => {
    expect(
      convertPartialEffectConfigToEngine("werkstatt", {
        source: "return input;",
      })
    ).toEqual({ source: "return input;" });
    expect(
      convertPartialEffectConfigToEngine("neuralAmp", {
        modelId: "local-model",
        modelUrl: "/models/local.nam",
      })
    ).toEqual({
      modelId: "local-model",
      modelUrl: "/models/local.nam",
    });
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

  test("keeps native reverb and delay stages wet-only behind Effect Mix", () => {
    for (const type of ["plateReverb", "delay", "cheapReverb"] as const) {
      const defaults = EFFECT_DEFINITIONS[type].defaultConfig;
      expect(defaults.dry).toBe(-72);
      expect(defaults.wet).toBe(0);

      const engine = convertEffectConfigToEngine({
        ...defaults,
        id: `${type}-wet-only`,
        order: 0,
      });
      expect(engine.dry).toBe(-72);
      expect(engine.wet).toBe(0);
      expect(engine.dryWet).toBe(defaults.dryWet);
    }
  });

  test("normalizes the default parallel composite without removing branches", () => {
    const { chains } = EFFECT_DEFINITIONS.fxComposite.defaultConfig;
    expect(chains).toHaveLength(2);
    expect(chains.every(({ gain }) => gain === Math.SQRT1_2)).toBe(true);
  });

  test("exposes the official stock-device control surfaces", () => {
    const expectedKeys = {
      autotune: ["key", "scale", "amount", "retuneAmount", "shift", "smooth"],
      cheapReverb: ["decay", "preDelay", "damp", "filter", "dry", "wet"],
      compressor: [
        "inputgain",
        "threshold",
        "ratio",
        "knee",
        "attack",
        "release",
        "makeup",
        "mix",
        "lookahead",
        "automakeup",
        "autoattack",
        "autorelease",
      ],
      delay: [
        "delayMusical",
        "delayMillis",
        "preSyncTimeLeft",
        "preMillisTimeLeft",
        "preSyncTimeRight",
        "preMillisTimeRight",
        "feedback",
        "cross",
        "filter",
        "lfoSpeed",
        "lfoDepth",
        "dry",
        "wet",
      ],
      gate: [
        "threshold",
        "return",
        "attack",
        "hold",
        "release",
        "floor",
        "inverse",
      ],
      maximizer: ["threshold", "lookaheadEnabled"],
      neuralAmp: ["input", "output", "mono", "mix"],
      tidal: [
        "rateDivision",
        "depth",
        "slope",
        "symmetry",
        "offset",
        "channelOffset",
      ],
      vocoder: [
        "carrierMinFreq",
        "carrierMaxFreq",
        "modulatorMinFreq",
        "modulatorMaxFreq",
        "qStart",
        "qEnd",
        "envAttack",
        "envRelease",
        "gain",
        "mix",
        "bandCount",
        "modulatorSource",
      ],
      waveshaper: ["equation", "deviceInputGain", "deviceOutputGain", "mix"],
    } as const;

    for (const [type, expected] of Object.entries(expectedKeys)) {
      const keys = getEffectParamDefs(type as EffectConfig["type"]).map(
        ({ key }) => key
      );
      expect(keys).toEqual(expect.arrayContaining(expected));
    }
    expect(getEffectParamDefs("werkstatt")).toEqual([]);
    expect(EFFECT_DEFINITIONS.werkstatt.defaultConfig).toMatchObject({
      parameters: {},
    });
    expect(EFFECT_DEFINITIONS.werkstatt.defaultConfig.code).toContain(
      "class Processor"
    );
  });

  test("backfills integration state without removing legacy defaults", () => {
    expect(EFFECT_DEFINITIONS.neuralAmp.defaultConfig).toMatchObject({
      modelData: null,
      modelId: null,
      modelName: null,
      modelUrl: null,
    });
    expect(EFFECT_DEFINITIONS.werkstatt.defaultConfig).toMatchObject({
      parameters: {},
      samples: {},
      source: "return input;",
    });
    expect(EFFECT_DEFINITIONS.frequencySplit.defaultConfig).toMatchObject({
      crossoverFrequencies: [200, 1000, 5000],
      frequencyBandCount: 4,
    });
  });
});
