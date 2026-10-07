import { expect, test } from "bun:test";
import { createDefaultEffectConfig } from "@/lib/audio/dsp/effects/registry";
import { compile } from "./compile";
import { modulationParameters } from "./modulation-parameters";
import { bindParam, mapParamValue } from "./param-binding";
import { type NodeGraphInput, nodeGraphSchema } from "./schema";

const position = { x: 0, y: 0 };
const env = { crossOriginIsolated: true };
const audio = (source: string, target: string) => ({
  id: `${source}:${target}`,
  source,
  sourceHandle: "out:audio:main",
  target,
  targetHandle: "in:audio:main",
});
function patch(nodes: NodeGraphInput["nodes"], pairs: string[][]) {
  return nodeGraphSchema.parse({
    edges: pairs.map(([source, target], index) => ({
      id: String(index),
      source,
      sourceHandle: "out:audio:main",
      target,
      targetHandle: "in:audio:main",
    })),
    nodes,
    version: 2,
  });
}
const station = {
  data: {
    radio: { id: "a", name: "a", streamUrl: "https://example.com/a.mp3" },
  },
  id: "a",
  position,
  type: "station" as const,
};
const gain = {
  data: { gainDb: -80.05 },
  id: "g",
  position,
  type: "gain" as const,
};
function edge(graph: ReturnType<typeof patch>, index: number) {
  const cable = graph.edges[index];
  if (!cable) {
    throw new Error("Missing test cable");
  }
  return cable;
}
const output = (id: string) => ({
  data: {},
  id,
  position,
  type: "speakers" as const,
});
const fx = (id: string) => ({
  data: {
    effect: { ...createDefaultEffectConfig("delay", id, 0), enabled: true },
  },
  id,
  position,
  type: "delay" as const,
});

test("compiler provenance preserves fan-out, cable gain and exact quiet restoration", () => {
  const graph = patch(
    [
      station,
      gain,
      fx("x"),
      fx("y"),
      output("o"),
      { data: {}, id: "p", position, type: "deviceOut" },
    ],
    [
      ["a", "g"],
      ["g", "x"],
      ["g", "y"],
      ["x", "o"],
      ["y", "p"],
    ]
  );
  const plan = compile(graph, env);
  const bindings = bindParam(graph, "g", "gainDb", plan);
  expect(bindings.length).toBe(2);
  for (const binding of bindings) {
    expect(mapParamValue(binding, -80.05)).toBe(binding.base);
    expect(mapParamValue(binding, -74.05) / binding.base).toBeCloseTo(
      10 ** (6 / 20)
    );
  }
  expect(graph.nodes.find((node) => node.id === "g")?.data).toEqual({
    gainDb: -80.05,
  });
});

test("strip trim and a Gain share provenance without changing the fader", () => {
  const graph = patch(
    [station, gain, output("o")],
    [
      ["a", "g"],
      ["g", "o"],
    ]
  );
  const plan = compile(graph, env);
  const trim = bindParam(graph, "a", "trimDb", plan);
  const folded = bindParam(graph, "g", "gainDb", plan);
  expect(trim[0]?.target).toEqual(folded[0]?.target);
  expect(plan.lanes.get("a")?.volume).toBe(1);
  expect(trim[0] && mapParamValue(trim[0], 6)).toBeCloseTo(
    (trim[0]?.base ?? 0) * 10 ** (6 / 20)
  );
});

test("numeric select fields cannot bind and Autotune outer sliders can bind", () => {
  const tune = {
    data: { effect: createDefaultEffectConfig("autotune", "t", 0) },
    id: "t",
    position,
    type: "autotune" as const,
  };
  const graph = patch(
    [station, tune, output("o")],
    [
      ["a", "t"],
      ["t", "o"],
    ]
  );
  const plan = compile(graph, env);
  const node = graph.nodes.find((entry) => entry.id === "t");
  expect(
    node && modulationParameters(node).map((parameter) => parameter.key)
  ).toContain("dryWet");
  expect(bindParam(graph, "t", "key", plan)).toEqual([]);
  expect(bindParam(graph, "t", "dryWet", plan)).toHaveLength(1);
});

test("folded controls bind the final physical level, including a zero output gain", () => {
  const first = fx("x");
  first.data.effect.outputGain = 0;
  const graph = patch(
    [station, first, { ...gain, data: { gainDb: -6 } }, fx("y"), output("o")],
    [
      ["a", "x"],
      ["x", "g"],
      ["g", "y"],
      ["y", "o"],
    ]
  );
  const plan = compile(graph, env);
  const [binding] = bindParam(graph, "x", "outputGain", plan);
  expect(binding).toBeDefined();
  if (binding) {
    expect(mapParamValue(binding, 0)).toBe(0);
    expect(mapParamValue(binding, 1)).toBeCloseTo(10 ** (-6 / 20));
  }
});

test("Pan after a merge binds its routed module", () => {
  const graph = patch(
    [
      station,
      { ...station, id: "b" },
      { data: {}, id: "m", position, type: "merge" },
      { data: { pan: 0.2 }, id: "P", position, type: "pan" },
      output("o"),
    ],
    [
      ["a", "m"],
      ["b", "m"],
      ["m", "P"],
      ["P", "o"],
    ]
  );
  expect(
    bindParam(graph, "P", "pan", compile(graph, env)).map(
      ({ target }) => target
    )
  ).toEqual([{ kind: "pan", laneId: "P" }]);
});

test("Filter on an open Split branch binds its routed module", () => {
  const split = createDefaultEffectConfig("fxComposite", "split", 0);
  const graph = patch(
    [
      station,
      { data: { effect: split }, id: "split", position, type: "fxComposite" },
      { data: {}, id: "F", position, type: "filter" },
      output("o"),
      { data: {}, id: "device", position, type: "deviceOut" },
    ],
    [
      ["a", "split"],
      ["split", "F"],
      ["F", "o"],
      ["split", "device"],
    ]
  );
  edge(graph, 1).sourceHandle = "out:audio:branch-1";
  edge(graph, 3).sourceHandle = "out:audio:branch-2";
  expect(
    bindParam(graph, "F", "frequency", compile(graph, env)).map(
      ({ target }) => target
    )
  ).toEqual([{ field: "frequency", kind: "filter", laneId: "F" }]);
});

test("equal key levels retain distinct Gain provenance", () => {
  const graph = patch(
    [
      station,
      { ...station, id: "b" },
      ...["g1", "g2"].map((id) => ({ ...gain, data: { gainDb: -6 }, id })),
      ...["A", "B"].map((id) => ({
        data: {
          effect: {
            ...createDefaultEffectConfig("compressor", id, 0),
            enabled: true,
          },
        },
        id,
        position,
        type: "compressor" as const,
      })),
      output("o"),
    ],
    [
      ["a", "g1"],
      ["a", "g2"],
      ["g1", "A"],
      ["g2", "B"],
      ["b", "A"],
      ["b", "B"],
      ["A", "o"],
      ["B", "o"],
    ]
  );
  edge(graph, 2).targetHandle = "in:sidechain:key";
  edge(graph, 3).targetHandle = "in:sidechain:key";
  const plan = compile(graph, env);
  const first = bindParam(graph, "g1", "gainDb", plan);
  const second = bindParam(graph, "g2", "gainDb", plan);
  expect(first.length).toBeGreaterThan(0);
  expect(second.length).toBeGreaterThan(0);
  expect(first.map(({ target }) => target)).not.toEqual(
    second.map(({ target }) => target)
  );
  for (const { target } of second) {
    expect(target.kind === "send" && plan.cables.has(target.edgeId)).toBe(true);
  }
});

test("a Follower on an unused Split port preserves the speaker routing", () => {
  const split = createDefaultEffectConfig("fxComposite", "split", 0);
  split.enabled = true;
  split.dryWet = 0.5;
  const graph = patch(
    [
      station,
      { data: { effect: split }, id: "split", position, type: "fxComposite" },
      { data: {}, id: "tap", position, type: "follower" },
      output("o"),
    ],
    [
      ["a", "split"],
      ["split", "o"],
    ]
  );
  edge(graph, 1).sourceHandle = "out:audio:branch-1";
  const before = compile(graph, env);
  graph.edges.push({
    ...edge(graph, 1),
    id: "tap",
    sourceHandle: "out:audio:branch-2",
    target: "tap",
  });
  const after = compile(graph, env);
  const speakers = (plan: ReturnType<typeof compile>) =>
    [...plan.cables.values()].filter((cable) => cable.to.id === "o");
  expect(speakers(after)).toEqual(speakers(before));
});

test("successive Pan and Filter nodes bind their distinct compiled scalars", () => {
  const graph = patch(
    [
      station,
      ...["p1", "p2"].map((id, index) => ({
        data: { pan: index * 0.4 },
        id,
        position,
        type: "pan" as const,
      })),
      ...["f1", "f2"].map((id, index) => ({
        data: { frequency: 1000 + index * 2000 },
        id,
        position,
        type: "filter" as const,
      })),
      fx("fx"),
      output("o"),
    ],
    [
      ["a", "p1"],
      ["p1", "p2"],
      ["p2", "f1"],
      ["f1", "f2"],
      ["f2", "fx"],
      ["fx", "o"],
    ]
  );
  const plan = compile(graph, env);
  expect(bindParam(graph, "p1", "pan", plan)[0]).toMatchObject({
    target: { kind: "pan", laneId: "a" },
  });
  expect(bindParam(graph, "f1", "frequency", plan)[0]).toMatchObject({
    target: { kind: "filter", laneId: "f1" },
  });
  expect(bindParam(graph, "p2", "pan", plan)[0]).toMatchObject({
    base: 0.4,
    target: { kind: "pan", laneId: "p2" },
  });
  expect(bindParam(graph, "f2", "frequency", plan)[0]).toMatchObject({
    base: 3000,
    target: { field: "frequency", kind: "filter", laneId: "f2" },
  });
});

test("a Filter lowered to Revamp keeps Q on its converted scalar path", () => {
  const graph = patch(
    [
      station,
      fx("first"),
      { data: { Q: 6 }, id: "F", position, type: "filter" },
      fx("last"),
      output("o"),
    ],
    [
      ["a", "first"],
      ["first", "F"],
      ["F", "last"],
      ["last", "o"],
    ]
  );
  const [binding] = bindParam(graph, "F", "Q", compile(graph, env));
  expect(binding).toMatchObject({
    base: 10 ** (6 / 20),
    coupled: true,
    kind: "gain",
  });
  if (binding) {
    expect(mapParamValue(binding, 12)).toBeCloseTo(10 ** (12 / 20));
  }
});

test("open Split Pan provenance binds after branch FX at the new exit balance", () => {
  const split = createDefaultEffectConfig("fxComposite", "split", 0);
  const [first] = split.chains;
  if (!first) {
    throw new Error("Missing branch");
  }
  split.enabled = true;
  first.pan = 0.5;
  const graph = nodeGraphSchema.parse({
    edges: [
      { ...audio("s", "split") },
      {
        ...audio("split", "fx"),
        pan: -0.25,
        sourceHandle: "out:audio:branch-1",
      },
      audio("fx", "pan"),
      audio("pan", "out"),
      { ...audio("split", "device"), sourceHandle: "out:audio:branch-2" },
    ],
    nodes: [
      { ...station, id: "s" },
      { data: { effect: split }, id: "split", position, type: "fxComposite" },
      {
        data: {
          effect: {
            ...createDefaultEffectConfig("delay", "fx", 0),
            enabled: true,
          },
        },
        id: "fx",
        position,
        type: "delay",
      },
      { data: { pan: -0.2 }, id: "pan", position, type: "pan" },
      { data: {}, id: "out", position, type: "speakers" },
      { data: {}, id: "device", position, type: "deviceOut" },
    ],
    version: 2,
  });
  const plan = compile(graph, env);
  expect(plan.issues).toEqual([]);
  const intoFx = [...plan.cables.values()].find(
    (cable) => cable.to.id === "fx"
  );
  const intoPan = [...plan.cables.values()].find(
    (cable) => cable.from.id === "fx" && cable.to.id === "pan"
  );
  expect(intoFx?.balance).toBeUndefined();
  expect(intoPan?.balance).toEqual([0.75, 1]);
  expect(bindParam(graph, "pan", "pan", plan)).toMatchObject([
    {
      authored: -0.2,
      base: -0.2,
      kind: "pan",
      target: { kind: "pan", laneId: "pan" },
    },
  ]);
});
