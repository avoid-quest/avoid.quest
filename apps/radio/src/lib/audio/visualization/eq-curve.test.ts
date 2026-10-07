import { describe, expect, test } from "bun:test";
import { applyEffectConfig } from "../dsp/effect-processor-factory";
import { orderOptions } from "../dsp/effects/effect-definition-shared";
import { createDefaultEffectConfig } from "../dsp/effects/registry";
import { RevampEffect } from "../dsp/effects/revamp";
import type { RevampConfig } from "../dsp/effects/types";
import { computeEQCurve } from "./eq-curve";

const SAMPLE_RATE = 48_000;

const revampConfig = (overrides: Partial<RevampConfig>): RevampConfig => ({
  ...createDefaultEffectConfig("revamp", "eq", 0),
  highBellEnabled: false,
  highPassEnabled: false,
  highShelfEnabled: false,
  lowBellEnabled: false,
  lowPassEnabled: false,
  lowShelfEnabled: false,
  midBellEnabled: false,
  ...overrides,
});

const curveDbAt = (config: RevampConfig, frequency: number): number =>
  computeEQCurve(config, Float32Array.of(frequency), SAMPLE_RATE).totalDb[0] ??
  Number.NaN;

/** Steady-state gain in dB the Revamp processor applies to a sine. */
const heardDbAt = (config: RevampConfig, frequency: number): number => {
  const revamp = new RevampEffect(SAMPLE_RATE);
  applyEffectConfig(revamp, "revamp", config);
  const length = SAMPLE_RATE;
  const input = Float32Array.from({ length }, (_, i) =>
    Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE)
  );
  const output: [Float32Array, Float32Array] = [
    new Float32Array(length),
    new Float32Array(length),
  ];
  for (let from = 0; from < length; from += 128) {
    revamp.process([input, input.slice()], output, from, from + 128);
  }
  let inputEnergy = 0;
  let outputEnergy = 0;
  for (let i = length / 2; i < length; i += 1) {
    inputEnergy += (input[i] ?? 0) ** 2;
    outputEnergy += (output[0][i] ?? 0) ** 2;
  }
  return 10 * Math.log10(outputEnergy / inputEnergy);
};

describe("EQ curve", () => {
  test("draws what the Revamp processor does to a tone", () => {
    const config = revampConfig({
      highPassEnabled: true,
      highPassFrequency: 400,
      highPassOrder: 3,
      highShelfEnabled: true,
      highShelfFrequency: 8000,
      highShelfGain: -6,
      midBellEnabled: true,
      midBellFrequency: 1000,
      midBellGain: 9,
      midBellQ: 2,
    });
    for (const frequency of [150, 400, 1000, 3000, 12_000]) {
      expect(curveDbAt(config, frequency)).toBeCloseTo(
        heardDbAt(config, frequency),
        1
      );
    }
  });

  test("labels each pass filter slope with the slope the processor gives", () => {
    for (const option of orderOptions) {
      const order = Number(option.value);
      const config = revampConfig({
        highPassEnabled: true,
        highPassFrequency: 4000,
        highPassOrder: order,
      });
      const slope = heardDbAt(config, 2000) - heardDbAt(config, 1000);
      expect(option.label).toBe(`${Math.round(slope)} dB/oct`);
    }
  });
});
