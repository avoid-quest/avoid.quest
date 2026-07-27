import { describe, expect, test } from "bun:test";
import { createDefaultEffectConfig } from "@/lib/audio";
import { MAX_EFFECT_TREE_DEPTH } from "@/lib/audio/dsp/routing/effect-tree";
import {
  canAddNestedEffect,
  resizeFrequencyChains,
  resizeFrequencyCrossovers,
} from "./container-params";

describe("Container nesting depth", () => {
  test("allows only leaf effects at the maximum child depth", () => {
    expect(canAddNestedEffect(MAX_EFFECT_TREE_DEPTH - 1, "compressor")).toBe(
      true
    );
    expect(canAddNestedEffect(MAX_EFFECT_TREE_DEPTH - 1, "fxComposite")).toBe(
      false
    );
    expect(canAddNestedEffect(MAX_EFFECT_TREE_DEPTH, "compressor")).toBe(false);
  });
});

describe("Frequency Split band resizing", () => {
  test("preserves low and high endpoint chains when adding or removing bands", () => {
    const chain = (id: string, order: number) => ({
      id,
      name: id,
      order,
      gain: 1,
      pan: 0,
      muted: false,
      solo: false,
      effects: [createDefaultEffectConfig("limiter", `${id}-effect`, 0)],
    });
    const twoBands = [chain("low", 0), chain("high", 1)];
    const expanded = resizeFrequencyChains(twoBands, 3, () => "new-mid");

    expect(expanded.map(({ id }) => id)).toEqual(["low", "new-mid", "high"]);
    expect(expanded.at(-1)?.effects[0]?.id).toBe("high-effect");

    const reduced = resizeFrequencyChains(
      [
        chain("low", 0),
        chain("low-mid", 1),
        chain("high-mid", 2),
        chain("high", 3),
      ],
      2
    );
    expect(reduced.map(({ id }) => id)).toEqual(["low", "high"]);
    expect(reduced.at(-1)?.effects[0]?.id).toBe("high-effect");
  });

  test("preserves applicable crossovers when reducing the band count", () => {
    expect(resizeFrequencyCrossovers([300, 2000, 8000], 3)).toEqual([
      300, 2000,
    ]);
    expect(resizeFrequencyCrossovers([300, 2000], 2)).toEqual([300]);
  });

  test("initializes only newly required crossovers when adding bands", () => {
    expect(resizeFrequencyCrossovers([300], 4)).toEqual([300, 1000, 5000]);
  });

  test("keeps expanded crossovers ordered inside the supported range", () => {
    expect(resizeFrequencyCrossovers([19_990], 4)).toEqual([
      19_960, 19_980, 20_000,
    ]);
    expect(resizeFrequencyCrossovers([Number.NaN], 3)).toEqual([20, 1000]);
  });
});
