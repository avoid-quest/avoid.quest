import { describe, expect, test } from "bun:test";
import { createDefaultEffectConfig } from "@/lib/audio";
import { effectsUseTempo } from "./effect-chain";

describe("effectsUseTempo", () => {
  test("is false for effects that never follow the synced tempo", () => {
    expect(
      effectsUseTempo([createDefaultEffectConfig("gate", "gate", 0)])
    ).toBe(false);
  });

  test("detects top-level tempo-synced effects", () => {
    expect(
      effectsUseTempo([createDefaultEffectConfig("delay", "delay", 0)])
    ).toBe(true);
  });

  test.each(["fxComposite", "stereoSplit", "frequencySplit"] as const)(
    "detects tempo-synced effects nested in %s",
    (type) => {
      const container = createDefaultEffectConfig(type, type, 0);
      const empty = effectsUseTempo([container]);
      const [, chain] = container.chains;
      if (!chain) {
        throw new Error("container has no second chain");
      }
      chain.effects = [createDefaultEffectConfig("tidal", "tidal", 0)];

      expect(empty).toBe(false);
      expect(effectsUseTempo([container])).toBe(true);
    }
  );
});
