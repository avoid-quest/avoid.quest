import { describe, expect, test } from "bun:test";
import type {
  EffectChainConfig,
  EffectConfig,
  FrequencySplitConfig,
  FxCompositeConfig,
  LimiterConfig,
  StereoSplitConfig,
} from "../effects/types";
import {
  appendEffectToTree,
  findEffectInTree,
  normalizeEffectTree,
  removeEffectFromTree,
  reorderEffectTreeChain,
  validateEffectTree,
} from "./effect-tree";

function limiter(id: string, order: number): LimiterConfig {
  return {
    id,
    type: "limiter",
    enabled: true,
    order,
    dryWet: 1,
    inputGain: 1,
    outputGain: 1,
    threshold: -1,
  };
}

function chain(
  id: string,
  order: number,
  effects: EffectConfig[]
): EffectChainConfig {
  return {
    id,
    name: id,
    order,
    gain: 1,
    pan: 0,
    muted: false,
    solo: false,
    effects,
  };
}

const containerBase = {
  enabled: true,
  order: 0,
  dryWet: 1,
  inputGain: 1,
  outputGain: 1,
} as const;

describe("recursive effect tree routing", () => {
  test("normalizes and JSON-round-trips nested container ordering", () => {
    const stereoSplit: StereoSplitConfig = {
      ...containerBase,
      id: "stereo",
      type: "stereoSplit",
      chains: [
        chain("right", 1, [limiter("right-2", 4), limiter("right-1", 1)]),
        chain("left", 0, [limiter("left-1", 5)]),
      ],
    };
    const composite: FxCompositeConfig = {
      ...containerBase,
      id: "composite",
      type: "fxComposite",
      order: 2,
      chains: [chain("parallel", 0, [stereoSplit])],
    };

    const normalized = normalizeEffectTree([
      composite,
      limiter("root-first", 0),
    ]);
    const roundTripped = JSON.parse(
      JSON.stringify(normalized)
    ) as EffectConfig[];

    expect(roundTripped).toEqual(normalized);
    expect(roundTripped.map(({ id, order }) => [id, order])).toEqual([
      ["root-first", 0],
      ["composite", 1],
    ]);
    expect(findEffectInTree(roundTripped, "right-1")?.order).toBe(0);
    expect(findEffectInTree(roundTripped, "right-2")?.order).toBe(1);
  });

  test("appends, reorders, and removes effects inside a nested chain", () => {
    const composite: FxCompositeConfig = {
      ...containerBase,
      id: "composite",
      type: "fxComposite",
      chains: [chain("parallel", 0, [limiter("first", 0)])],
    };

    const appended = appendEffectToTree(
      [composite],
      limiter("second", 99),
      "parallel"
    );
    const reordered = reorderEffectTreeChain(
      appended,
      ["second", "first"],
      "parallel"
    );
    const removed = removeEffectFromTree(reordered, "first");

    expect(findEffectInTree(reordered, "second")?.order).toBe(0);
    expect(findEffectInTree(reordered, "first")?.order).toBe(1);
    expect(findEffectInTree(removed, "first")).toBeUndefined();
    expect(findEffectInTree(removed, "second")?.order).toBe(0);
  });

  test("rejects invalid sidechains, duplicate IDs, and container shapes", () => {
    const invalidFrequencySplit: FrequencySplitConfig = {
      ...containerBase,
      id: "frequency",
      type: "frequencySplit",
      crossoverFrequencies: [400, 200, 2000],
      chains: [
        chain("duplicate-chain", 0, [
          {
            ...limiter("duplicate-effect", 0),
            sidechain: { channelId: "missing-deck" },
          },
        ]),
        chain("duplicate-chain", 1, [limiter("duplicate-effect", 0)]),
      ],
    };

    const errors = validateEffectTree(
      [invalidFrequencySplit],
      new Set(["deck-a", "deck-b"])
    );

    expect(errors).toContain("Unknown sidechain channel: missing-deck");
    expect(errors).toContain("Duplicate effect id: duplicate-effect");
    expect(errors).toContain("Duplicate effect chain id: duplicate-chain");
    expect(errors).toContain(
      "Frequency Split requires 2–4 bands with ascending crossovers"
    );
  });
});
