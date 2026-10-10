import { describe, expect, test } from "bun:test";
import { CTAGCompressor } from "../dsp/effects/ctag-compressor";
import { computeCompressorCurve } from "./compressor-curve";

const config = {
  inputgain: 0,
  knee: 12,
  makeup: 0,
  mix: 1,
  ratio: 4,
  threshold: -24,
};

const levels = (from: number, to: number, step: number) =>
  Float32Array.from(
    { length: Math.round((to - from) / step) + 1 },
    (_, i) => from + i * step
  );

/** Steady-state output level in dB the compressor gives a constant input. */
const heardDb = (inputDb: number, settings = config): number => {
  const compressor = new CTAGCompressor(48_000);
  compressor.setConfig({
    ...settings,
    attack: 1,
    inputGain: settings.inputgain,
    lookahead: false,
  });
  const level = 10 ** (inputDb / 20);
  const input: [Float32Array, Float32Array] = [
    new Float32Array(128).fill(level),
    new Float32Array(128).fill(level),
  ];
  const output: [Float32Array, Float32Array] = [
    new Float32Array(128),
    new Float32Array(128),
  ];
  for (let block = 0; block < 2000; block += 1) {
    compressor.process(input, output, 0, 128);
  }
  return 20 * Math.log10(Math.abs(output[0][127] ?? 0));
};

describe("compressor curve", () => {
  test("bends smoothly through the soft knee", () => {
    const inputDb = levels(-40, 0, 0.05);
    const outputDb = computeCompressorCurve(config, inputDb);
    for (let i = 1; i < outputDb.length; i += 1) {
      const step = (outputDb[i] ?? 0) - (outputDb[i - 1] ?? 0);
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThanOrEqual(0.05 + 1e-4);
    }
  });

  test("draws the level the compressor actually outputs", () => {
    for (const inputDb of [-36, -27, -24, -21, -12, -3]) {
      const [drawn] = computeCompressorCurve(config, Float32Array.of(inputDb));
      expect(drawn ?? Number.NaN).toBeCloseTo(heardDb(inputDb), 1);
    }
  });

  test("draws the top ratio the way the compressor runs it", () => {
    const top = { ...config, ratio: 24 };
    const [drawn] = computeCompressorCurve(top, Float32Array.of(-3));
    expect(drawn ?? Number.NaN).toBeCloseTo(heardDb(-3, top), 1);
  });

  test("draws the device input gain and mix the way the compressor runs them", () => {
    const driven = { ...config, inputgain: 9, makeup: 3, mix: 0.4 };
    for (const inputDb of [-40, -30, -18, -6]) {
      const [drawn] = computeCompressorCurve(driven, Float32Array.of(inputDb));
      expect(drawn ?? Number.NaN).toBeCloseTo(heardDb(inputDb, driven), 1);
    }
  });
});
