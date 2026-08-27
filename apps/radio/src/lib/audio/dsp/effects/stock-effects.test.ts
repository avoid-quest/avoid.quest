import { describe, expect, test } from "bun:test";
import { applyEffectConfig } from "../effect-processor-factory";
import { createDefaultEffectConfig } from "./registry";
import {
  GateEffect,
  VocoderEffect,
  WaveshaperEffect,
  WerkstattEffect,
} from "./stock-effects";
import type { StereoChannels } from "./types";

const stereo = (value: number): StereoChannels => [
  new Float32Array(128).fill(value),
  new Float32Array(128).fill(value),
];

describe("stock compatibility processors", () => {
  test("Vocoder reuses its filter channel views across render quanta", () => {
    const effect = new VocoderEffect(48_000);
    const internals = effect as unknown as {
      carrierFilters: Array<{
        process: (
          input: StereoChannels,
          output: StereoChannels,
          fromIndex: number,
          toIndex: number
        ) => void;
      }>;
      modulatorFilters: Array<{
        process: (
          input: StereoChannels,
          output: StereoChannels,
          fromIndex: number,
          toIndex: number
        ) => void;
      }>;
    };
    const outputs: StereoChannels[] = [];
    for (const filter of [
      internals.modulatorFilters[0],
      internals.carrierFilters[0],
    ]) {
      if (!filter) {
        throw new Error("Vocoder filter missing");
      }
      const process = filter.process.bind(filter);
      filter.process = (input, output, fromIndex, toIndex) => {
        outputs.push(output);
        process(input, output, fromIndex, toIndex);
      };
    }

    effect.process(stereo(0.25), stereo(0), 0, 128);
    effect.process(stereo(0.25), stereo(0), 0, 128);

    expect(outputs[0]).toBe(outputs[2]);
    expect(outputs[1]).toBe(outputs[3]);
  });

  test("Vocoder keeps its filter bank when unrelated config changes", () => {
    const effect = new VocoderEffect(48_000);
    const config = createDefaultEffectConfig("vocoder", "vocoder", 0);
    applyEffectConfig(
      effect,
      "vocoder",
      config as unknown as Record<string, unknown>
    );
    const filterBank = (effect as unknown as { carrierFilters: unknown[] })
      .carrierFilters;

    applyEffectConfig(effect, "vocoder", {
      ...config,
      gain: (config.gain ?? 0) + 1,
    });

    expect(
      (effect as unknown as { carrierFilters: unknown[] }).carrierFilters
    ).toBe(filterBank);
  });

  test("Werkstatt hot-swaps bounded expressions and bypasses unsafe source", () => {
    const effect = new WerkstattEffect(48_000);
    const output = stereo(0);
    effect.setParameters({ drive: 2 });
    effect.setSource("return input * p.drive;");
    effect.process(stereo(0.25), output, 0, 128);
    expect(output[0][64]).toBeCloseTo(0.5);

    effect.setSource("while (true) {}");
    effect.process(stereo(0.25), output, 0, 128);
    expect(output[0][64]).toBeCloseTo(0.25);
  });

  test("Werkstatt compatibility uses edited code over the legacy source", () => {
    const effect = new WerkstattEffect(48_000);
    const output = stereo(0);
    applyEffectConfig(effect, "werkstatt", {
      code: `class Processor {
        drive = 1
        paramChanged(label, value) {
          if (label === "drive") this.drive = value
        }
        process({ src, out }, { s0, s1 }) {
          for (let index = s0; index < s1; index++) {
            out[0][index] = src[0][index] * this.drive
            out[1][index] = src[1][index] * this.drive
          }
        }
      }`,
      parameters: { drive: 2 },
      source: "return input;",
    });

    effect.process(stereo(0.25), output, 0, 128);

    expect(output[0][64]).toBeCloseTo(0.5);
  });

  test("Gate uses an external sidechain when supplied", () => {
    const gate = new GateEffect(48_000);
    gate.setThreshold(-20);
    gate.setAttack(0.1);
    gate.setRelease(1);
    gate.setFloor(-120);
    const output = stereo(0);

    gate.setSidechainInput(stereo(1));
    for (let block = 0; block < 10; block += 1) {
      gate.process(stereo(0.25), output, 0, 128);
    }
    expect(output[0][127]).toBeGreaterThan(0.2);

    gate.setSidechainInput(stereo(0));
    for (let block = 0; block < 10; block += 1) {
      gate.process(stereo(0.25), output, 0, 128);
    }
    expect(Math.abs(output[0][127] ?? 0)).toBeLessThan(0.01);
  });

  test("Gate honors the exposed 0–1000 ms attack range", () => {
    const gate = new GateEffect(48_000);
    const attack = () => (gate as unknown as { attack: number }).attack;

    gate.setAttack(0);
    expect(attack()).toBe(0);
    gate.setAttack(750);
    expect(attack()).toBe(750);
    gate.setAttack(1000);
    expect(attack()).toBe(1000);
  });

  test("Waveshaper exposes all six finite transfer curves", () => {
    const effect = new WaveshaperEffect();
    const output = stereo(0);
    for (const curve of [
      "hardClip",
      "cubicSoft",
      "tanh",
      "sigmoid",
      "arctan",
      "asymmetric",
    ]) {
      effect.setCurve(curve);
      effect.process(stereo(0.75), output, 0, 128);
      expect(Number.isFinite(output[0][64])).toBe(true);
    }
  });
});
