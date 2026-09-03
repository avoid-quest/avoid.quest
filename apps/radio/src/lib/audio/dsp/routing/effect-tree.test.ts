import { describe, expect, test } from "bun:test";
import type { EffectChainConfig, EffectConfig } from "../effects/types";
import {
  appendEffectToTree,
  findEffectChain,
  findEffectInTree,
  normalizeEffectTree,
  removeEffectFromTree,
  reorderEffectTreeChain,
  updateEffectInTree,
  validateEffectTree,
} from "./effect-tree";

function effect(id: string, order: number): EffectConfig {
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
  effects: EffectConfig[] = []
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

describe("effect tree routing", () => {
  test("normalizes persisted order recursively", () => {
    const composite: EffectConfig = {
      ...effect("composite", 0),
      chains: [
        chain("second", 2, [effect("nested-b", 4), effect("nested-a", 1)]),
        chain("first", 0),
      ],
      type: "fxComposite",
    };

    const normalized = normalizeEffectTree([effect("last", 9), composite]);
    const [normalizedComposite] = normalized;

    expect(normalized.map(({ id, order }) => [id, order])).toEqual([
      ["composite", 0],
      ["last", 1],
    ]);
    expect(
      normalizedComposite?.type === "fxComposite"
        ? normalizedComposite.chains.map(({ id, order }) => [id, order])
        : []
    ).toEqual([
      ["first", 0],
      ["second", 1],
    ]);
    expect(
      findEffectChain(normalized, "second")?.effects.map(({ id, order }) => [
        id,
        order,
      ])
    ).toEqual([
      ["nested-a", 0],
      ["nested-b", 1],
    ]);
  });

  test("adds, updates, reorders, and removes nested effects by stable ids", () => {
    const tree: EffectConfig[] = [
      {
        ...effect("composite", 0),
        chains: [chain("parallel", 0)],
        type: "fxComposite",
      },
    ];

    const appended = appendEffectToTree(
      tree,
      effect("nested-a", 99),
      "parallel"
    );
    const withSecond = appendEffectToTree(
      appended,
      effect("nested-b", 99),
      "parallel"
    );
    const reordered = reorderEffectTreeChain(
      withSecond,
      ["nested-b", "nested-a"],
      "parallel"
    );
    const updated = updateEffectInTree(reordered, "nested-a", {
      enabled: false,
    });
    const removed = removeEffectFromTree(updated, "nested-b");

    expect(findEffectInTree(removed, "nested-a")?.enabled).toBe(false);
    expect(findEffectInTree(removed, "nested-b")).toBeUndefined();
    expect(
      findEffectChain(removed, "parallel")?.effects.map(({ id, order }) => [
        id,
        order,
      ])
    ).toEqual([["nested-a", 0]]);
  });

  test("validates variable split routing and sidechain references", () => {
    const split: EffectConfig = {
      ...effect("split", 0),
      chains: [
        chain("low", 0),
        chain("low-mid", 1, [
          {
            ...effect("gate", 0),
            attack: 1,
            floor: -60,
            hold: 10,
            inverse: false,
            release: 100,
            sidechain: { channelId: "missing" },
            threshold: -24,
            type: "gate",
          },
        ]),
      ],
      crossoverFrequencies: [2000],
      type: "frequencySplit",
    };

    expect(validateEffectTree([split], new Set(["deck-a"]))).toEqual([
      "Unknown sidechain channel: missing",
    ]);

    const threeBandSplit: EffectConfig = {
      ...split,
      chains: [...split.chains, chain("high", 2)],
      crossoverFrequencies: [1000, 5000],
    };
    expect(validateEffectTree([threeBandSplit], new Set(["deck-a"]))).toEqual([
      "Unknown sidechain channel: missing",
    ]);

    split.crossoverFrequencies = [8000, 2000];
    expect(validateEffectTree([split], new Set(["deck-a"]))).toContain(
      "Frequency Split requires 2–4 bands with ascending crossovers"
    );
  });
});
