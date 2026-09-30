import { describe, expect, test } from "bun:test";
import { effectConfigSchema } from "./effect-config-schema";
import { createDefaultEffectConfig } from "./registry";
import { EFFECT_TYPES } from "./types";

describe("effectConfigSchema", () => {
  test("accepts every effect's defaults", () => {
    for (const type of EFFECT_TYPES) {
      const config = createDefaultEffectConfig(type, `${type}-1`, 0);
      expect(effectConfigSchema.safeParse(config).success).toBe(true);
    }
  });

  test("refuses a mistyped effect param", () => {
    const config = {
      ...createDefaultEffectConfig("compressor", "comp", 0),
      threshold: "bad",
    };
    expect(effectConfigSchema.safeParse(config).success).toBe(false);
  });

  test("refuses a universal param outside its range", () => {
    const base = createDefaultEffectConfig("compressor", "comp", 0);
    for (const patch of [
      { inputGain: 1e12 },
      { outputGain: -1 },
      { dryWet: 2 },
    ]) {
      expect(effectConfigSchema.safeParse({ ...base, ...patch }).success).toBe(
        false
      );
    }
  });
});
