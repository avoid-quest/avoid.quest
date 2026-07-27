import { describe, expect, test } from "bun:test";
import { GateEffect, WaveshaperEffect, WerkstattEffect } from "./stock-effects";
import type { StereoChannels } from "./types";

const stereo = (value: number): StereoChannels => [
  new Float32Array(128).fill(value),
  new Float32Array(128).fill(value),
];

describe("stock compatibility processors", () => {
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

  test("Gate uses an external sidechain when supplied", () => {
    const gate = new GateEffect(48_000);
    gate.setThreshold(-20);
    gate.setAttack(0.1);
    gate.setRelease(1);
    gate.setFloor(-120);
    const output = stereo(0);

    gate.setSidechainInput(stereo(1));
    for (let block = 0; block < 10; block++) {
      gate.process(stereo(0.25), output, 0, 128);
    }
    expect(output[0][127]).toBeGreaterThan(0.2);

    gate.setSidechainInput(stereo(0));
    for (let block = 0; block < 10; block++) {
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
