import { describe, expect, test } from "bun:test";
import { EFFECT_TYPES, isEffectType } from "./types";

describe("Effect Types", () => {
  test("EFFECT_TYPES contains all expected effect types", () => {
    const expectedTypes = [
      "plateReverb",
      "pitchShifter",
      "delay",
      "distortion",
      "compressor",
      "crusher",
      "fold",
      "stereoTool",
      "revamp",
      "tidal",
      "limiter",
    ] as const;

    expect(EFFECT_TYPES).toHaveLength(expectedTypes.length);
    for (const type of expectedTypes) {
      expect(EFFECT_TYPES).toContain(type);
    }
  });

  test("isEffectType returns true for valid effect types", () => {
    for (const type of EFFECT_TYPES) {
      expect(isEffectType(type)).toBe(true);
    }
  });

  test("isEffectType returns false for invalid effect types", () => {
    expect(isEffectType("invalid")).toBe(false);
    expect(isEffectType("")).toBe(false);
    expect(isEffectType("biquadFilter")).toBe(false); // Removed type
  });

  test("EFFECT_TYPES does not contain biquadFilter", () => {
    expect(EFFECT_TYPES).not.toContain("biquadFilter");
  });
});
