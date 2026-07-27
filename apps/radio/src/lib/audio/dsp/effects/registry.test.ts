import { describe, expect, test } from "bun:test";
import {
  AVAILABLE_EFFECTS,
  createDefaultEffectConfig,
  getEffectMetadata,
} from "./registry";
import type { CompressorConfig, EffectType } from "./types";

describe("Effect Registry", () => {
  describe("AVAILABLE_EFFECTS", () => {
    test("contains all expected effect types", () => {
      const effectTypes = AVAILABLE_EFFECTS.map((e) => e.type);

      expect(effectTypes).toContain("plateReverb");
      expect(effectTypes).toContain("pitchShifter");
      expect(effectTypes).toContain("delay");
      expect(effectTypes).toContain("distortion");
      expect(effectTypes).toContain("compressor");
      expect(effectTypes).toContain("crusher");
      expect(effectTypes).toContain("fold");
      expect(effectTypes).toContain("stereoTool");
      expect(effectTypes).toContain("revamp");
      expect(effectTypes).toContain("tidal");
      expect(effectTypes).toContain("limiter");
    });

    test("each effect has required metadata fields", () => {
      for (const effect of AVAILABLE_EFFECTS) {
        expect(effect.type).toBeDefined();
        expect(effect.name).toBeDefined();
        expect(typeof effect.name).toBe("string");
        expect(effect.description).toBeDefined();
        expect(typeof effect.description).toBe("string");
        expect(effect.defaultConfig).toBeDefined();
        expect(effect.defaultConfig.type).toBe(effect.type);
      }
    });

    test("default configs have common fields", () => {
      for (const effect of AVAILABLE_EFFECTS) {
        const config = effect.defaultConfig;

        expect(typeof config.enabled).toBe("boolean");
        expect(typeof config.dryWet).toBe("number");
        expect(typeof config.inputGain).toBe("number");
        expect(typeof config.outputGain).toBe("number");
      }
    });
  });

  describe("getEffectMetadata", () => {
    test("returns metadata for valid effect type", () => {
      const metadata = getEffectMetadata("plateReverb");

      expect(metadata).toBeDefined();
      expect(metadata?.type).toBe("plateReverb");
      expect(metadata?.name).toBe("Dattorro Reverb");
    });

    test("returns undefined for unknown effect type", () => {
      const metadata = getEffectMetadata("unknownEffect" as EffectType);

      expect(metadata).toBeUndefined();
    });

    test("returns correct metadata for each effect type", () => {
      for (const effect of AVAILABLE_EFFECTS) {
        const metadata = getEffectMetadata(effect.type);

        expect(metadata).toBeDefined();
        expect(metadata?.type).toBe(effect.type);
        expect(metadata?.name).toBe(effect.name);
        expect(metadata?.description).toBe(effect.description);
      }
    });
  });

  describe("createDefaultEffectConfig", () => {
    test("creates config with provided id and order", () => {
      const config = createDefaultEffectConfig("plateReverb", "test-id", 5);

      expect(config.id).toBe("test-id");
      expect(config.order).toBe(5);
      expect(config.type).toBe("plateReverb");
    });

    test("includes all default values from metadata", () => {
      const config = createDefaultEffectConfig(
        "compressor",
        "comp-1",
        0
      ) as CompressorConfig;

      expect(config.type).toBe("compressor");
      expect(config.threshold).toBe(-10);
      expect(config.ratio).toBe(4);
      expect(config.attack).toBe(2);
      expect(config.release).toBe(140);
      expect(config.knee).toBe(6);
      expect(config.enabled).toBe(false);
    });

    test("throws for unknown effect type", () => {
      expect(() => {
        createDefaultEffectConfig("unknownEffect" as EffectType, "id", 0);
      }).toThrow("Unknown effect type: unknownEffect");
    });

    test("throws with descriptive error message", () => {
      let thrownError: Error | null = null;
      try {
        createDefaultEffectConfig("notARealEffect" as EffectType, "id", 0);
      } catch (e) {
        thrownError = e as Error;
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError?.message).toContain("notARealEffect");
    });

    test("works for all valid effect types", () => {
      for (const effect of AVAILABLE_EFFECTS) {
        const config = createDefaultEffectConfig(
          effect.type,
          `test-${effect.type}`,
          0
        );

        expect(config).toBeDefined();
        expect(config.id).toBe(`test-${effect.type}`);
        expect(config.type).toBe(effect.type);
      }
    });

    test("creates configs with correct type-specific properties", () => {
      const reverb = createDefaultEffectConfig("plateReverb", "rev", 0);
      expect(reverb).toHaveProperty("decay");
      expect(reverb).toHaveProperty("damping");
      expect(reverb).toHaveProperty("preDelayMillis");

      const delay = createDefaultEffectConfig("delay", "del", 0);
      expect(delay).toHaveProperty("delayTime");
      expect(delay).toHaveProperty("feedback");

      const limiter = createDefaultEffectConfig("limiter", "lim", 0);
      expect(limiter).toHaveProperty("threshold");

      const distortion = createDefaultEffectConfig("distortion", "dist", 0);
      expect(distortion).toHaveProperty("amount");
      expect(distortion).toHaveProperty("oversample");
    });

    test("order can be any non-negative integer", () => {
      const config0 = createDefaultEffectConfig("limiter", "id", 0);
      const config10 = createDefaultEffectConfig("limiter", "id", 10);
      const config100 = createDefaultEffectConfig("limiter", "id", 100);

      expect(config0.order).toBe(0);
      expect(config10.order).toBe(10);
      expect(config100.order).toBe(100);
    });

    test("id can be any string", () => {
      const config1 = createDefaultEffectConfig("limiter", "", 0);
      const config2 = createDefaultEffectConfig("limiter", "a".repeat(100), 0);
      const config3 = createDefaultEffectConfig(
        "limiter",
        "special-chars_123",
        0
      );

      expect(config1.id).toBe("");
      expect(config2.id).toBe("a".repeat(100));
      expect(config3.id).toBe("special-chars_123");
    });
  });
});
