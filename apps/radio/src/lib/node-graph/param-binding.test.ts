import { describe, expect, test } from "bun:test";
import type { EffectType } from "@/lib/audio/dsp/effects/types";
import { readLaneParam, withLaneParam } from "@/lib/node-engine/params";
import { createNodeEffectConfig } from "./catalogue";
import { compile } from "./compile";
import {
  setEffectParams,
  setNativeParams,
  setSourceStrip,
} from "./graph-edits";
import { bindParam, mapParamValue } from "./param-binding";
import { type NodeGraph, type NodeGraphInput, nodeGraphSchema } from "./schema";

type NodeInput = NodeGraphInput["nodes"][number];
const position = { x: 0, y: 0 };
const station: NodeInput = {
  data: {
    radio: { id: "a", name: "a", streamUrl: "https://radio.example/a.mp3" },
    strip: { pan: 0.7, trimDb: -3 },
  },
  id: "a",
  position,
  type: "station",
};
const speakers: NodeInput = {
  data: {},
  id: "speakers",
  position,
  type: "speakers",
};
const gain: NodeInput = {
  data: { gainDb: -80.05 },
  id: "gain",
  position,
  type: "gain",
};
const fx = (id: string, type: EffectType = "compressor"): NodeInput =>
  ({
    data: { effect: { ...createNodeEffectConfig(type, id), enabled: true } },
    id,
    position,
    type,
  }) as NodeInput;
const cable = (source: string, target: string, from = "main", level = 0.6) => ({
  gain: level,
  id: `${source}->${target}`,
  source,
  sourceHandle: `out:audio:${from}`,
  target,
  targetHandle: "in:audio:main",
});
const env = { crossOriginIsolated: true };

function series(nodes: NodeInput[]): NodeGraph {
  const ids = ["a", ...nodes.map((node) => node.id), "speakers"];
  return nodeGraphSchema.parse({
    edges: ids.slice(1).map((id, index) => cable(ids[index], id)),
    nodes: [station, ...nodes, speakers],
    version: 2,
  });
}

function expectRecompile(
  graph: NodeGraph,
  nodeId: string,
  key: string,
  value: number
) {
  const bindings = bindParam(graph, nodeId, key, env);
  if (!Array.isArray(bindings)) {
    throw new Error(`Binding failed: ${bindings}`);
  }
  expect(bindings.length).toBeGreaterThan(0);
  const node = graph.nodes.find((current) => current.id === nodeId);
  let changed: NodeGraph;
  if (key.startsWith("strip.")) {
    changed = setSourceStrip(graph, nodeId, { [key.slice(6)]: value });
  } else if (node && "effect" in node.data) {
    changed = setEffectParams(graph, nodeId, { [key]: value });
  } else {
    changed = setNativeParams(graph, nodeId, { [key]: value });
  }
  const next = compile(changed, env);
  expect(next.issues).toEqual([]);
  for (const binding of bindings) {
    const effective = mapParamValue(binding, value);
    if (binding.target.kind === "send") {
      expect(effective).toBeCloseTo(
        next.edges.get(binding.target.edgeId)?.gain ?? Number.NaN,
        10
      );
    } else {
      const lane = next.lanes.get(binding.target.laneId);
      if (!lane) {
        throw new Error("Missing bound lane");
      }
      const actual = withLaneParam(lane, binding.target, effective);
      expect(readLaneParam(actual, binding.target) ?? Number.NaN).toBeCloseTo(
        readLaneParam(lane, binding.target) ?? Number.NaN,
        10
      );
    }
  }
  return bindings;
}

describe("parameter bindings", () => {
  test.each([
    ["leading signal trim", [gain, fx("comp")], "signalGain"],
    ["between effects", [fx("first"), gain, fx("second")], "outputGain"],
    ["trailing send", [fx("comp"), gain], "send"],
    [
      "after bare Autotune",
      [fx("tune", "autotune"), gain, fx("comp")],
      "signalGain",
    ],
  ] as const)(
    "Gain folding matches recompilation: %s",
    (_name, nodes, field) => {
      const graph = series([...nodes]);
      const bindings = expectRecompile(graph, "gain", "gainDb", -9);
      expect(
        bindings.some(({ target }) =>
          target.kind === "send"
            ? field === "send"
            : "field" in target && target.field === field
        )
      ).toBe(true);
      const authored = compile(graph, env);
      for (const binding of bindings) {
        const baseline =
          binding.target.kind === "send"
            ? authored.edges.get(binding.target.edgeId)?.gain
            : readLaneParam(
                authored.lanes.get(binding.target.laneId) as NonNullable<
                  ReturnType<typeof authored.lanes.get>
                >,
                binding.target
              );
        expect(mapParamValue(binding, -80.05)).toBe(baseline as number);
      }
    }
  );

  test("one Gain fans out to all sends and preserves each cable and strip factor", () => {
    const graph = series([gain]);
    const output: NodeInput = {
      data: { deviceId: "usb" },
      id: "device",
      position,
      type: "deviceOut",
    };
    const branched = nodeGraphSchema.parse({
      ...graph,
      edges: [...graph.edges, cable("gain", "device", "main", 0.2)],
      nodes: [...graph.nodes, output],
    });
    const bindings = expectRecompile(branched, "gain", "gainDb", 3);
    expect(bindings.map(({ target }) => target)).toEqual([
      { edgeId: "gain->speakers", kind: "send" },
      { edgeId: "gain->device", kind: "send" },
    ]);
    expectRecompile(branched, "a", "strip.trimDb", -12);
  });

  test("branch Gains resolve to live cell controls", () => {
    const merge: NodeInput = { data: {}, id: "merge", position, type: "merge" };
    const graph = nodeGraphSchema.parse({
      edges: [
        cable("a", "split"),
        cable("split", "gain", "branch-1"),
        cable("gain", "merge"),
        cable("split", "merge", "branch-2"),
        cable("merge", "speakers"),
      ],
      nodes: [station, fx("split", "fxComposite"), gain, merge, speakers],
      version: 2,
    });
    const bindings = expectRecompile(graph, "gain", "gainDb", -6);
    expect(
      bindings.some(
        ({ target }) =>
          target.kind === "chain" &&
          target.effectId === "split" &&
          target.field === "gain"
      )
    ).toBe(true);
  });

  test("strip and graph pans retain their distinct bases even at a clamped sum", () => {
    const graph = series([
      { data: { pan: 0.8 }, id: "pan", position, type: "pan" },
    ]);
    expectRecompile(graph, "pan", "pan", -0.6);
    expectRecompile(graph, "a", "strip.pan", -0.9);
  });

  test("numeric effect and filter controls bind; layout-changing or unknown params do not", () => {
    expectRecompile(series([fx("comp")]), "comp", "threshold", -25);
    expectRecompile(
      series([{ data: {}, id: "filter", position, type: "filter" }]),
      "filter",
      "frequency",
      1600
    );
    expect(
      bindParam(series([fx("tune", "autotune")]), "tune", "dryWet", env)
    ).toBe("structural");
    expect(bindParam(series([gain]), "gain", "missing", env)).toBe(
      "unavailable"
    );
  });
});
