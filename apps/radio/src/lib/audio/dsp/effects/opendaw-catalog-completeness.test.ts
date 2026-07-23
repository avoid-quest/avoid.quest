import { describe, expect, test } from "bun:test";
import { validateEffectTree } from "../routing/effect-tree";
import {
  AVAILABLE_EFFECTS,
  createDefaultEffectConfig,
  OPENDAW_AVAILABLE_EFFECTS,
  RADIO_AVAILABLE_EFFECTS,
} from "./registry";
import { EFFECT_DEFINITIONS } from "./schema";
import {
  EFFECT_TYPES,
  type EffectConfig,
  OPENDAW_EFFECT_TYPES,
  RADIO_EFFECT_TYPES,
} from "./types";

const EXPECTED_OPENDAW_EFFECT_TYPES = [
  "plateReverb",
  "crusher",
  "fold",
  "revamp",
  "delay",
  "compressor",
  "stereoTool",
  "tidal",
  "cheapReverb",
  "gate",
  "waveshaper",
  "maximizer",
  "vocoder",
  "neuralAmp",
  "werkstatt",
  "autotune",
  "fxComposite",
  "stereoSplit",
  "frequencySplit",
] as const;

describe("openDAW audio effect catalog", () => {
  test("exposes the exact 16 effects and three containers", () => {
    expect(OPENDAW_EFFECT_TYPES).toEqual(EXPECTED_OPENDAW_EFFECT_TYPES);
    expect(new Set(OPENDAW_EFFECT_TYPES)).toHaveLength(19);
  });

  test("preserves the three radio-specific effects without duplicate IDs", () => {
    expect(RADIO_EFFECT_TYPES).toEqual([
      "pitchShifter",
      "distortion",
      "limiter",
    ]);
    expect(EFFECT_TYPES).toEqual([
      ...EXPECTED_OPENDAW_EFFECT_TYPES,
      ...RADIO_EFFECT_TYPES,
    ]);
    expect(new Set(EFFECT_TYPES)).toHaveLength(22);
  });

  test("keeps definitions, registry families, and defaults in exact lockstep", () => {
    expect(Object.keys(EFFECT_DEFINITIONS).sort()).toEqual(
      [...EFFECT_TYPES].sort()
    );
    expect(OPENDAW_AVAILABLE_EFFECTS.map(({ type }) => type)).toEqual([
      ...OPENDAW_EFFECT_TYPES,
    ]);
    expect(RADIO_AVAILABLE_EFFECTS.map(({ type }) => type)).toEqual([
      ...RADIO_EFFECT_TYPES,
    ]);
    expect(AVAILABLE_EFFECTS.map(({ type }) => type)).toEqual([
      ...EFFECT_TYPES,
    ]);

    for (const [order, type] of EFFECT_TYPES.entries()) {
      const config = createDefaultEffectConfig(type, `effect-${type}`, order);
      expect(config.type).toBe(type);
      expect(config.id).toBe(`effect-${type}`);
      expect(config.order).toBe(order);
    }
  });

  test("ships valid default shapes for all three recursive containers", () => {
    const defaults: EffectConfig[] = [];
    for (const type of [
      "fxComposite",
      "stereoSplit",
      "frequencySplit",
    ] as const) {
      const config = createDefaultEffectConfig(type, `${type}-a`, 0);
      expect(validateEffectTree([config], new Set())).toEqual([]);
      defaults.push(
        config,
        createDefaultEffectConfig(type, `${type}-b`, defaults.length + 1)
      );
    }
    expect(validateEffectTree(defaults, new Set())).toEqual([]);
  });
});
