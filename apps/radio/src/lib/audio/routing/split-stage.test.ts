import { describe, expect, test } from "bun:test";
import { createDefaultEffectConfig } from "../dsp/effects/registry";
import {
  OfflineGraph,
  type OfflineNode,
  residualDb,
  testProgram,
} from "./offline-graph";
import { createSplitStage, type SplitEffect } from "./split-stage";

const FRAMES = 9600;
/** Checked over the last 100 ms, once the filters have settled. */
const TAIL = 4800;

/** A split as the registry makes it, a Band Split at two bands. */
function split(
  type: SplitEffect["type"],
  overrides: Partial<SplitEffect> = {}
): SplitEffect {
  const base = createDefaultEffectConfig(type, "split", 0) as SplitEffect;
  return {
    ...base,
    ...(base.type === "frequencySplit"
      ? { chains: base.chains.slice(0, 2), crossoverFrequencies: [1000] }
      : {}),
    enabled: true,
    ...overrides,
  } as SplitEffect;
}

/** Renders `effect` with `cabled` ports, each port and their sum. */
function render(effect: SplitEffect, cabled: number[], sampleRate?: number) {
  const graph = new OfflineGraph(sampleRate);
  const [left, right] = testProgram(FRAMES);
  const source = graph.createSource(left, right);
  const stage = createSplitStage(graph as unknown as BaseAudioContext, {
    cabled,
    effect,
  });
  source.connect(stage.input as unknown as OfflineNode);
  const sum = graph.createGain();
  for (const position of cabled) {
    (stage.port(position) as unknown as OfflineNode).connect(sum);
  }
  return {
    graph,
    input: [left, right],
    port: (position: number) =>
      graph.render(stage.port(position) as unknown as OfflineNode, FRAMES),
    stage,
    sum: () => graph.render(sum, FRAMES),
  };
}

describe("createSplitStage", () => {
  test("stereo split ports carry independent left and right signals", () => {
    const { input, port } = render(split("stereoSplit"), [0, 1]);
    const silence = new Float32Array(FRAMES);

    expect(residualDb(port(0), [input[0], silence], TAIL)).toBeLessThan(-90);
    expect(residualDb(port(1), [silence, input[1]], TAIL)).toBeLessThan(-90);
  });

  test("Split ports each carry the whole signal", () => {
    const { input, port } = render(split("fxComposite"), [0, 2]);
    expect(residualDb(port(0), input, TAIL)).toBeLessThan(-90);
    expect(residualDb(port(2), input, TAIL)).toBeLessThan(-90);
  });

  test("a crossover at or past Nyquist passes everything into the band below", () => {
    // 20 kHz is past a 32 kHz context's 16 kHz Nyquist.
    const effect = split("frequencySplit", { crossoverFrequencies: [20_000] });
    const { input, port } = render(effect, [0, 1], 32_000);
    const silence = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
    expect(residualDb(port(0), input, TAIL)).toBeLessThan(-90);
    expect(residualDb(port(1), silence, TAIL)).toBeLessThan(-90);
  });

  test("the signal trim precedes every port and follows the enabled state in place", () => {
    const effect = split("fxComposite", { signalGain: 0.5 });
    const { input, port, stage } = render(effect, [0, 1]);
    const half = input.map((channel) => channel.map((sample) => sample * 0.5));
    expect(residualDb(port(0), half, TAIL)).toBeLessThan(-90);
    expect(residualDb(port(1), half, TAIL)).toBeLessThan(-90);

    stage.update({ cabled: [0, 1], effect: { ...effect, signalGain: 0 } });
    expect(
      port(0).every((channel) => channel.every((sample) => sample === 0))
    ).toBe(true);
    stage.update({ cabled: [0, 1], effect: { ...effect, enabled: false } });
    expect(residualDb(port(0), input, TAIL)).toBeLessThan(-90);
  });

  test("Band Split ports keep their bands, on or off, and sum to the input", () => {
    for (const overrides of [{ enabled: false }, { enabled: true }]) {
      const bands = split("frequencySplit", overrides);
      const effect = {
        ...bands,
        chains: bands.chains.slice(0, 3),
        crossoverFrequencies: [300, 2000],
      } as SplitEffect;
      const { input, port, sum } = render(effect, [0, 1, 2]);
      expect(residualDb(sum(), input, TAIL)).toBeLessThan(-60);
      // The low band holds the 110 Hz tone, not the 7 kHz one.
      const low = port(0);
      const high = port(2);
      expect(residualDb(low, [new Float32Array(FRAMES)], TAIL)).toBeGreaterThan(
        residualDb(high, [new Float32Array(FRAMES)], TAIL)
      );
    }
  });

  test("its input and cabled ports stay the same nodes across a crossover move", () => {
    const effect = split("frequencySplit") as Extract<
      SplitEffect,
      { type: "frequencySplit" }
    >;
    const { input, stage, sum } = render(effect, [0, 1]);
    const entry = stage.input;
    const low = stage.port(0);

    stage.update({
      cabled: [0, 1],
      effect: { ...effect, crossoverFrequencies: [800] },
    });

    expect(stage.input).toBe(entry);
    expect(stage.port(0)).toBe(low);
    expect(residualDb(sum(), input, TAIL)).toBeLessThan(-60);
    // An uncabled port has no output.
    stage.update({ cabled: [0], effect });
    expect(stage.port(1)).toBeNull();
  });
});
