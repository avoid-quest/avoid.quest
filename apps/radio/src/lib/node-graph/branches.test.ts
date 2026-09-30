import { describe, expect, test } from "bun:test";
import type {
  EffectType,
  FrequencySplitConfig,
  FxCompositeConfig,
} from "@/lib/audio/dsp/effects/types";
import {
  branchBaseGain,
  branchCables,
  branchName,
  branchTag,
  crossoverRange,
  isSplitNode,
  resizeCrossovers,
  type SplitNode,
  setBandCount,
  setBranchParams,
  setCrossover,
  splitPortIds,
} from "./branches";
import { createNodeEffectConfig } from "./catalogue";
import { type NodeGraph, type NodeGraphInput, nodeGraphSchema } from "./schema";

type NodeInput = NodeGraphInput["nodes"][number];

function split(id: string, type: EffectType): NodeInput {
  return {
    data: { effect: createNodeEffectConfig(type, id) },
    id,
    position: { x: 0, y: 0 },
    type,
  } as NodeInput;
}

function out(source: string, port: string, target = "speakers") {
  return {
    id: `${source}.${port}`,
    source,
    sourceHandle: `out:audio:${port}`,
    target,
    targetHandle: "in:audio:main",
  };
}

function patch(nodes: NodeInput[], edges: ReturnType<typeof out>[] = []) {
  return nodeGraphSchema.parse({
    edges,
    nodes: [
      ...nodes,
      { data: {}, id: "speakers", position: { x: 0, y: 0 }, type: "speakers" },
    ],
    version: 2,
  });
}

function nodeOf(graph: NodeGraph, id: string): SplitNode {
  const node = graph.nodes.find((entry) => entry.id === id);
  if (!isSplitNode(node)) {
    throw new Error(`${id} is not a split`);
  }
  return node;
}

function bandsOf(graph: NodeGraph, id: string): FrequencySplitConfig {
  return nodeOf(graph, id).data.effect as FrequencySplitConfig;
}

describe("branch base gain", () => {
  test("uses the configured chain in port order and defaults for extra branches", () => {
    const graph = patch([
      split("s", "fxComposite"),
      split("lr", "stereoSplit"),
    ]);
    const node = nodeOf(graph, "s");
    expect(branchBaseGain(node, "out:audio:branch-1")).toBe(Math.SQRT1_2);
    expect(branchBaseGain(node, "out:audio:branch-3")).toBe(Math.SQRT1_2);
    expect(branchBaseGain(nodeOf(graph, "lr"), "out:audio:left")).toBe(1);
    const effect = node.data.effect as FxCompositeConfig;
    const configured = {
      ...node,
      data: {
        effect: {
          ...effect,
          chains: effect.chains
            .map((chain) => ({
              ...chain,
              gain: chain.order === 0 ? 0.5 : 0.25,
            }))
            .reverse(),
        },
      },
    };
    expect(branchBaseGain(configured, "out:audio:branch-1")).toBe(0.5);
    expect(branchBaseGain(configured, "out:audio:branch-2")).toBe(0.25);
  });
});

describe("split ports", () => {
  test("a Split shows the branches in use plus one, from two to four", () => {
    const empty = patch([split("s", "fxComposite")]);
    expect(splitPortIds(nodeOf(empty, "s"), empty.edges)).toEqual([
      "branch-1",
      "branch-2",
    ]);
    const two = patch(
      [split("s", "fxComposite")],
      [out("s", "branch-1"), out("s", "branch-2")]
    );
    expect(splitPortIds(nodeOf(two, "s"), two.edges)).toHaveLength(3);
    const four = patch([split("s", "fxComposite")], [out("s", "branch-4")]);
    expect(splitPortIds(nodeOf(four, "s"), four.edges)).toHaveLength(4);
  });

  test("a Stereo Split shows left and right, a Band Split one port per band", () => {
    const graph = patch([
      split("lr", "stereoSplit"),
      split("bands", "frequencySplit"),
    ]);
    expect(splitPortIds(nodeOf(graph, "lr"), [])).toEqual(["left", "right"]);
    expect(splitPortIds(nodeOf(graph, "bands"), [])).toEqual([
      "band-1",
      "band-2",
      "band-3",
      "band-4",
    ]);
  });

  test("branches are named for the canvas tag and the inspector", () => {
    const graph = setBandCount(
      patch([
        split("s", "fxComposite"),
        split("lr", "stereoSplit"),
        split("bands", "frequencySplit"),
      ]),
      "bands",
      3
    );
    expect(branchName(nodeOf(graph, "s"), "out:audio:branch-2")).toBe(
      "Branch 2"
    );
    expect(branchTag(nodeOf(graph, "s"), "out:audio:branch-2")).toBe("2");
    expect(branchTag(nodeOf(graph, "lr"), "out:audio:right")).toBe("R");
    expect(branchName(nodeOf(graph, "bands"), "out:audio:band-2")).toBe("Mid");
  });
});

describe("branch cables", () => {
  const graph = patch(
    [split("s", "fxComposite")],
    [out("s", "branch-2"), out("s", "branch-1")]
  );

  test("are listed in port order", () => {
    expect(branchCables(graph, "s").map((edge) => edge.id)).toEqual([
      "s.branch-1",
      "s.branch-2",
    ]);
  });

  test("carry gain, pan, mute and solo, and a no-op edit keeps the graph", () => {
    const edited = setBranchParams(graph, "s.branch-1", {
      gain: 0.5,
      muted: true,
      pan: -1,
      solo: true,
    });
    expect(edited.edges.find((edge) => edge.id === "s.branch-1")).toMatchObject(
      { gain: 0.5, muted: true, pan: -1, solo: true }
    );
    expect(setBranchParams(edited, "s.branch-1", { solo: true })).toBe(edited);
  });
});

describe("Band Split", () => {
  const base = patch(
    [split("bands", "frequencySplit")],
    [out("bands", "band-1"), out("bands", "band-4")]
  );

  test("fewer bands drops the top ones and their cables", () => {
    const two = setBandCount(base, "bands", 2);
    const effect = bandsOf(two, "bands");

    expect(effect.crossoverFrequencies).toEqual([200]);
    expect(effect.chains.map((chain) => chain.name)).toEqual(["Low", "High"]);
    expect(effect.frequencyBandCount).toBe(2);
    expect(two.edges.map((edge) => edge.id)).toEqual(["bands.band-1"]);
    expect(setBandCount(two, "bands", 2)).toBe(two);
  });

  test("more bands keeps the low crossovers and adds increasing ones", () => {
    const four = setBandCount(setBandCount(base, "bands", 2), "bands", 4);
    const crossovers = bandsOf(four, "bands").crossoverFrequencies;

    expect(crossovers).toEqual([200, 1000, 5000]);
    expect(resizeCrossovers([9000], 4)).toEqual([9000, 9020, 9040]);
  });

  test("a crossover is held between its neighbours", () => {
    const moved = setCrossover(base, "bands", 1, 50);
    expect(bandsOf(moved, "bands").crossoverFrequencies).toEqual([
      200, 220, 5000,
    ]);
    expect(crossoverRange([200, 1000, 5000], 2)).toEqual({
      max: 20_000,
      min: 1020,
    });
    expect(setCrossover(base, "bands", 7, 50)).toBe(base);
  });
});
