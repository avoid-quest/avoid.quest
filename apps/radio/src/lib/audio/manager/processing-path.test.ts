import { describe, expect, test } from "bun:test";
import type { EffectConfig } from "../dsp/effects/types";
import {
  hasActiveEffects,
  shouldUseWorkletProcessing,
} from "./processing-path";

const activeDelay = {
  id: "delay-1",
  type: "delay",
  enabled: true,
  order: 0,
  dryWet: 1,
  inputGain: 1,
  outputGain: 1,
  delayTime: 0.25,
  feedback: 0.3,
} satisfies EffectConfig;

describe("processing path helpers", () => {
  test("detects active effects", () => {
    expect(hasActiveEffects([activeDelay])).toBeTrue();
    expect(hasActiveEffects([{ ...activeDelay, enabled: false }])).toBeFalse();
  });

  test("bypasses worklet when no enabled effects exist", () => {
    expect(
      shouldUseWorkletProcessing({
        effects: [],
        effectsDryWet: 1,
      })
    ).toBeFalse();
  });

  test("bypasses worklet when master dry/wet is effectively zero", () => {
    expect(
      shouldUseWorkletProcessing({
        effects: [activeDelay],
        effectsDryWet: 0,
      })
    ).toBeFalse();
  });

  test("uses worklet when enabled effects are present and dry/wet is active", () => {
    expect(
      shouldUseWorkletProcessing({
        effects: [activeDelay],
        effectsDryWet: 1,
      })
    ).toBeTrue();
  });
});
