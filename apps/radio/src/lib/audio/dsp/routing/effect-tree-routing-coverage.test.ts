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
    dryWet: 1,
    enabled: true,
    id,
    inputGain: 1,
    order,
    outputGain: 1,
    threshold: -1,
    type: "limiter",
  };
}

function chain(
  id: string,
  order: number,
  effects: EffectConfig[]
): EffectChainConfig {
  return {
    effects,
    gain: 1,
    id,
    muted: false,
    name: id,
    order,
    pan: 0,
    solo: false,
  };
}

const containerBase = {
  dryWet: 1,
  enabled: true,
  inputGain: 1,
  order: 0,
  outputGain: 1,
} as const;

describe("recursive effect tree routing", () => {
  test("normalizes and JSON-round-trips nested container ordering", () => {
    const stereoSplit: StereoSplitConfig = {
      ...containerBase,
      chains: [
        chain("right", 1, [limiter("right-2", 4), limiter("right-1", 1)]),
        chain("left", 0, [limiter("left-1", 5)]),
      ],
      id: "stereo",
      type: "stereoSplit",
    };
    const composite: FxCompositeConfig = {
      ...containerBase,
      chains: [chain("parallel", 0, [stereoSplit])],
      id: "composite",
      order: 2,
      type: "fxComposite",
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
      chains: [chain("parallel", 0, [limiter("first", 0)])],
      id: "composite",
      type: "fxComposite",
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
      chains: [
        chain("duplicate-chain", 0, [
          {
            ...limiter("duplicate-effect", 0),
            sidechain: { channelId: "missing-deck" },
          },
        ]),
        chain("duplicate-chain", 1, [limiter("duplicate-effect", 0)]),
      ],
      crossoverFrequencies: [400, 200, 2000],
      id: "frequency",
      type: "frequencySplit",
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
