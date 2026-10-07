import { describe, expect, test } from "bun:test";
import { Mixing, StereoMatrix } from "@opendaw/lib-dsp";
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
function render(effect: SplitEffect, cabled: number[]) {
  const graph = new OfflineGraph();
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

/** What the same container outputs rejoined at a unity Merge, no FX in it. */
function rejoined(effect: SplitEffect, input: Float32Array[]) {
  if (!effect.enabled) {
    return input;
  }
  const w = effect.dryWet;
  const chains = [...effect.chains].sort((a, b) => a.order - b.order);
  const anySolo = chains.some((chain) => chain.solo);
  // Each open branch: its share of the input, its gain and its balance.
  const wet = input.map(() => new Float32Array(FRAMES));
  for (const [index, chain] of chains.entries()) {
    if (chain.muted || (anySolo && !chain.solo)) {
      continue;
    }
    const [toLeft, toRight] = StereoMatrix.panningToGains(
      chain.pan,
      Mixing.Linear
    );
    for (const [side, balance] of [toLeft, toRight].entries()) {
      // A Stereo Split's branch k is side k; a Split's every side. A Band
      // Split's bands sum to the input, at the one gain all bands share.
      if (
        (effect.type === "stereoSplit" && side !== index) ||
        (effect.type === "frequencySplit" && index > 0)
      ) {
        continue;
      }
      const from = input[side] ?? new Float32Array(FRAMES);
      const into = wet[side] ?? new Float32Array(FRAMES);
      for (let frame = 0; frame < FRAMES; frame += 1) {
        into[frame] =
          (into[frame] ?? 0) +
          effect.inputGain * chain.gain * balance * (from[frame] ?? 0);
      }
    }
  }
  return input.map((channel, side) =>
    channel.map(
      (x, frame) =>
        effect.outputGain * ((1 - w) * x + w * (wet[side]?.[frame] ?? 0))
    )
  );
}

describe("createSplitStage", () => {
  test("stereo split ports carry independent left and right signals", () => {
    const { input, port } = render(split("stereoSplit"), [0, 1]);
    const silence = new Float32Array(FRAMES);

    expect(residualDb(port(0), [input[0], silence], TAIL)).toBeLessThan(-90);
    expect(residualDb(port(1), [silence, input[1]], TAIL)).toBeLessThan(-90);
  });

  test.each([
    [true, 1],
    [true, 0.5],
    [true, 0],
    [false, 0.5],
  ])(
    "split ports sum to the rejoined split, with one bypass, at enabled=%p, mix=%p",
    (enabled, dryWet) => {
      for (const type of [
        "fxComposite",
        "stereoSplit",
        "frequencySplit",
      ] as const) {
        const effect = split(type, { dryWet, enabled });
        const { input, sum } = render(effect, [0, 1]);
        expect(residualDb(sum(), rejoined(effect, input), TAIL)).toBeLessThan(
          -60
        );
      }
    }
  );

  test("the input trim acts on the wet path only, the output trim only while on", () => {
    for (const enabled of [true, false]) {
      const effect = split("fxComposite", {
        dryWet: 0.5,
        enabled,
        inputGain: 0.5,
        outputGain: 2,
      });
      const { input, sum } = render(effect, [0, 1]);
      expect(residualDb(sum(), rejoined(effect, input), TAIL)).toBeLessThan(
        -60
      );
    }
    // Off, the trims are out of the path: the ports sum to the input.
    const off = render(
      split("frequencySplit", {
        enabled: false,
        inputGain: 0.1,
        outputGain: 4,
      }),
      [0, 1]
    );
    expect(residualDb(off.sum(), off.input, TAIL)).toBeLessThan(-60);
  });

  test.each([-1, -0.5, 0, 0.5, 1])(
    "a branch's pan is openDAW's linear balance, with no crossfeed, at %p",
    (pan) => {
      const effect = split("fxComposite", { dryWet: 1 });
      const chains = effect.chains.map((chain) => ({ ...chain, gain: 1, pan }));
      const { input, port } = render({ ...effect, chains } as SplitEffect, [0]);
      const [toLeft, toRight] = StereoMatrix.panningToGains(pan, Mixing.Linear);
      expect(
        residualDb(
          port(0),
          [input[0].map((x) => x * toLeft), input[1].map((x) => x * toRight)],
          TAIL
        )
      ).toBeLessThan(-90);
    }
  );

  test("disabled and dry Band Split outputs keep their band signals, and sum to the input", () => {
    for (const overrides of [{ enabled: false }, { dryWet: 0 }]) {
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

  test("configured and cable solos form one branch set; mutes gate the wet part", () => {
    const effect = split("fxComposite", { dryWet: 1 });
    const soloed = effect.chains.map((chain, index) => ({
      ...chain,
      solo: index === 1,
    }));
    const solo = render({ ...effect, chains: soloed } as SplitEffect, [0, 1]);
    const silence = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
    expect(residualDb(solo.port(0), silence, TAIL)).toBeLessThan(-90);
    expect(residualDb(solo.port(1), silence, TAIL)).toBeGreaterThan(-30);

    const muted = effect.chains.map((chain, index) => ({
      ...chain,
      muted: index === 0,
    }));
    const mute = render({ ...effect, chains: muted } as SplitEffect, [0, 1]);
    expect(residualDb(mute.port(0), silence, TAIL)).toBeLessThan(-90);
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
