import { describe, expect, test } from "bun:test";
import { createDefaultEffectConfig } from "@/lib/audio/dsp/effects/registry";
import {
  type EngineParamTarget,
  paramKey,
} from "@/lib/node-engine/param-target";
import { createParameters } from "@/lib/node-engine/params";
import { compile } from "./compile";
import { connectNodes } from "./graph-edits";
import {
  installModulationAudio,
  ownModulation,
  TestModulationWorklet,
} from "./modulation.test-helpers";
import {
  modulatedValue,
  modulationParameters,
  NATIVE_PARAM_RANGES,
  parameterCables,
  setModulatorParams,
} from "./modulation-parameters";
import { modulationProgram } from "./modulation-program";
import {
  createModulationRuntime,
  unappliedModulation,
} from "./modulation-runtime";
import {
  MODULATION_NODE_TYPES,
  type ModulationNodeType,
} from "./modulation-schema";
import { createNodeStore } from "./node-store";
import { createPaletteNode } from "./palette";
import { bindParam } from "./param-binding";
import { type NodeGraph, nodeGraphSchema } from "./schema";
import { connectionVerdict, validate } from "./validate";

const position = { x: 0, y: 0 };
const env = { crossOriginIsolated: true };
const audio = (source: string, target: string) => ({
  id: `${source}:${target}`,
  source,
  sourceHandle: "out:audio:main",
  target,
  targetHandle: "in:audio:main",
});
const control = (
  source: string,
  target: string,
  parameter: string,
  depth = 0.25
) => ({
  depth,
  id: `${source}:${target}:${parameter}`,
  parameter,
  source,
  sourceHandle: "out:control:main",
  target,
  targetHandle: "in:control:parameter",
});
function palette(type: ModulationNodeType, id: string) {
  const node = createPaletteNode(type, id, position);
  if (!node) {
    throw new Error("Missing palette source");
  }
  return node;
}
function patch(): NodeGraph {
  return nodeGraphSchema.parse({
    edges: [
      audio("s", "cut"),
      audio("cut", "fx"),
      audio("fx", "out"),
      audio("fx", "follower"),
      control("lfo", "cut", "frequency"),
    ],
    nodes: [
      {
        data: {
          radio: { name: "Test", streamUrl: "https://example.com/audio.mp3" },
        },
        id: "s",
        position,
        type: "station",
      },
      { data: {}, id: "cut", position, type: "filter" },
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
      { id: "out", position, type: "speakers" },
      ...MODULATION_NODE_TYPES.map((type) => palette(type, type)),
    ],
    version: 2,
  });
}
async function harness(
  graph: NodeGraph,
  unavailable: (target: EngineParamTarget) => string | null = () => null
) {
  installModulationAudio();
  const values = new Map<string, number>();
  let available = true;
  const cleared: string[] = [];
  const runtime = createModulationRuntime({
    engine: {
      clearTransient: (target) => {
        if (target) {
          cleared.push(paramKey(target));
          values.delete(paramKey(target));
        }
      },
      onParamsChanged: () => () => undefined,
      onTapsChanged: () => () => undefined,
      paramSoundId: () => "live-sound",
      paramUnavailable: (target) =>
        available ? unavailable(target) : "Nothing plays through it yet",
      setParam: (target, value) => {
        values.set(paramKey(target), value);
        return "applied";
      },
      tap: () => null,
    },
    getNativeHost: async () => null,
    getWorkletProcessorUrl: () => "/dsp.js",
  });
  ownModulation(runtime);
  runtime.sync(graph, compile(graph, env));
  await runtime.whenSettled();
  const delivery = runtime;
  return {
    cleared,
    delivery,
    emit: (outputs: Record<string, number>) => {
      TestModulationWorklet.current.emit(outputs);
    },
    unavailable: () => {
      available = false;
      delivery.refresh();
    },
    values,
  };
}
const cutoff: EngineParamTarget = {
  field: "frequency",
  kind: "filter",
  laneId: "s",
};

describe("resolved modulation delivery", () => {
  test.each(["inputGain", "outputGain"] as const)(
    "a Split key authored at zero %s stays connected only while modulation can raise it",
    async (parameter) => {
      const split = {
        ...createDefaultEffectConfig("fxComposite", "split", 0),
        dryWet: 1,
        enabled: true,
        [parameter]: 0,
      };
      const graph = nodeGraphSchema.parse({
        edges: [
          audio("s", "split"),
          { ...audio("split", "out"), sourceHandle: "out:audio:branch-1" },
          {
            ...audio("split", "fx"),
            sourceHandle: "out:audio:branch-1",
            targetHandle: "in:sidechain:key",
          },
          { ...audio("split", "device"), sourceHandle: "out:audio:branch-2" },
          audio("carrier", "fx"),
          audio("fx", "out"),
          control("mod", "split", parameter, 0.1),
        ],
        nodes: [
          patch().nodes[0],
          { ...patch().nodes[0], id: "carrier" },
          {
            data: { effect: split },
            id: "split",
            position,
            type: "fxComposite",
          },
          {
            data: { effect: createDefaultEffectConfig("compressor", "fx", 0) },
            id: "fx",
            position,
            type: "compressor",
          },
          { data: {}, id: "out", position, type: "speakers" },
          { data: {}, id: "device", position, type: "deviceOut" },
          palette("midiIn", "mod"),
        ],
        version: 2,
      });
      const plan = compile(graph, env);
      expect(plan.issues).toEqual([]);
      const key = [...plan.cables.values()].find(
        (cable) => cable.kind === "key"
      );
      expect(key).toMatchObject({
        gain: 0,
        to: { id: "node-key:fx", kind: "key" },
      });
      expect(plan.modules.get("key:node-key:fx")?.kind).toBe("key");
      expect(plan.lanes.get("carrier")?.effects[0]?.sidechain).toEqual({
        channelId: "node-key:fx",
      });
      const h = await harness(graph);
      h.emit({ mod: 1 });
      expect(
        h.values.get(paramKey({ edgeId: key?.id ?? "", kind: "send" }))
      ).toBeCloseTo(0.4 * (split.chains[0]?.gain ?? 1));
      h.emit({ mod: 0 });
      expect(h.values.size).toBe(0);
      for (const inactive of [
        {
          ...graph,
          edges: graph.edges.filter((edge) => edge.source !== "mod"),
        },
        {
          ...graph,
          edges: graph.edges.map((edge) =>
            edge.source === "mod" ? { ...edge, depth: 0 } : edge
          ),
        },
        {
          ...graph,
          edges: graph.edges.map((edge) =>
            edge.source === "mod" ? { ...edge, muted: true } : edge
          ),
        },
        setModulatorParams(graph, "mod", { enabled: false }),
        {
          ...graph,
          edges: graph.edges.map((edge) =>
            edge.targetHandle === "in:sidechain:key"
              ? { ...edge, gain: 0 }
              : edge
          ),
        },
      ]) {
        const silent = compile(inactive, env);
        expect(
          [...silent.cables.values()].some((cable) => cable.kind === "key")
        ).toBe(false);
        expect(silent.modules.has("key:node-key:fx")).toBe(false);
        expect(
          silent.lanes.get("carrier")?.effects[0]?.sidechain
        ).toBeUndefined();
      }
    }
  );

  test("new cables choose an unused target parameter before duplicate validation", () => {
    const graph = patch();
    const connection = {
      source: "lfo",
      sourceHandle: "out:control:main",
      target: "cut",
      targetHandle: "in:control:parameter",
    };
    expect(connectionVerdict(graph, connection)).toEqual({ ok: true });
    const connected = connectNodes(graph, connection);
    expect(connected.edges.at(-1)?.parameter).toBe("Q");
    expect(validate(connected)).toEqual([]);
    expect(connectionVerdict(connected, connection)).toMatchObject({
      code: "duplicate-edge",
      ok: false,
    });
  });

  test.each([
    { enabled: true, input: 0.4, mix: 0.5, output: 0.2 },
    { enabled: true, input: 0.4, mix: 0, output: 0.2 },
    { enabled: false, input: 0.4, mix: 0.5, output: 0.2 },
    { enabled: true, input: 0, mix: 0.5, output: 0.2 },
    { enabled: true, input: 0.4, mix: 0.5, output: 0 },
  ])(
    "an open Split preserves fixed factors while a branch Gain moves: %j",
    async ({ enabled, mix, input, output }) => {
      const split = {
        ...createDefaultEffectConfig("fxComposite", "split", 0),
        dryWet: mix,
        enabled,
        inputGain: input,
        outputGain: output,
      };
      const [first] = split.chains;
      if (!first) {
        throw new Error("Missing branch");
      }
      first.gain = 0.7;
      const graph = nodeGraphSchema.parse({
        edges: [
          audio("s", "split"),
          {
            ...audio("split", "gain"),
            gain: 0.6,
            sourceHandle: "out:audio:branch-1",
          },
          audio("gain", "out"),
          { ...audio("split", "device"), sourceHandle: "out:audio:branch-2" },
          control("mod", "gain", "gainDb", 0.1),
          control("mix", "split", "dryWet", 0.1),
          control("input", "split", "inputGain", 0.1),
          control("output", "split", "outputGain", 0.1),
        ],
        nodes: [
          patch().nodes[0],
          {
            data: { effect: split },
            id: "split",
            position,
            type: "fxComposite",
          },
          { data: { gainDb: 6 }, id: "gain", position, type: "gain" },
          { data: {}, id: "out", position, type: "speakers" },
          { data: {}, id: "device", position, type: "deviceOut" },
          palette("shapedLfo", "mod"),
          palette("clock", "mix"),
          palette("midiIn", "input"),
          palette("slew", "output"),
        ],
        version: 2,
      });
      const plan = compile(graph, env);
      const wet = [...plan.cables.values()].find((cable) =>
        cable.edges.includes("gain:out")
      );
      if (!wet) {
        throw new Error("Missing wet path");
      }
      const expected = enabled
        ? 0.6 * input * mix * output * 0.7 * 10 ** (6 / 20)
        : 0;
      expect(wet.gain).toBeCloseTo(expected);
      const h = await harness(graph);
      h.emit({ mod: 1 });
      expect(
        h.values.get(paramKey({ edgeId: wet.id, kind: "send" }))
      ).toBeCloseTo(expected * 10 ** (6.4 / 20));
      h.emit({ mod: 0 });
      expect(h.values.size).toBe(0);
    }
  );

  test.each([0, 0.5, 1])(
    "open Split universal controls preserve wet/dry factors at Mix %s",
    async (mix) => {
      const split = {
        ...createDefaultEffectConfig("fxComposite", "split", 0),
        dryWet: mix,
        enabled: true,
        inputGain: 0,
        outputGain: 0,
      };
      const graph = nodeGraphSchema.parse({
        edges: [
          audio("s", "split"),
          { ...audio("split", "out"), sourceHandle: "out:audio:branch-1" },
          { ...audio("split", "device"), sourceHandle: "out:audio:branch-2" },
          control("mix", "split", "dryWet", mix === 1 ? -0.1 : 0.1),
          control("input", "split", "inputGain", 0.1),
          control("output", "split", "outputGain", 0.05),
        ],
        nodes: [
          patch().nodes[0],
          {
            data: { effect: split },
            id: "split",
            position,
            type: "fxComposite",
          },
          { data: {}, id: "out", position, type: "speakers" },
          { data: {}, id: "device", position, type: "deviceOut" },
          palette("midiIn", "mix"),
          palette("shapedLfo", "input"),
          palette("clock", "output"),
        ],
        version: 2,
      });
      const plan = compile(graph, env);
      const h = await harness(graph);
      h.emit({ input: 1, mix: 1, output: 1 });
      const nextMix = mix === 1 ? 0.9 : mix + 0.1;
      const wet = [...plan.cables.values()].find((cable) =>
        cable.edges.includes("split:out")
      );
      const dry = [...plan.cables.values()].find(
        (cable) => cable.to.id === "out" && cable.edges.length === 0
      );
      expect(wet).toBeDefined();
      expect(dry).toBeDefined();
      if (!(wet && dry)) {
        throw new Error("Missing Split paths");
      }
      expect(
        h.values.get(paramKey({ edgeId: wet.id, kind: "send" }))
      ).toBeCloseTo(nextMix * 0.4 * 0.2 * (split.chains[0]?.gain ?? 1));
      expect(
        h.values.get(paramKey({ edgeId: dry.id, kind: "send" }))
      ).toBeCloseTo((1 - nextMix) * 0.5 * 0.2);
      h.emit({ input: 0, mix: 0, output: 0 });
      expect(h.values.size).toBe(0);
      expect(unappliedModulation.state["mix:split:dryWet"]).toBeUndefined();
    }
  );
  test("all twelve defaults round-trip, ship and leave one audio lane", () => {
    const graph = patch();
    expect(nodeGraphSchema.parse(JSON.parse(JSON.stringify(graph)))).toEqual(
      graph
    );
    expect(validate(graph)).toEqual([]);
    const plan = compile(graph, env);
    expect(plan.issues).toEqual([]);
    expect([...plan.lanes.keys()]).toEqual(["s"]);
    expect(plan.modules.get("tap:follower")?.kind).toBe("tap");
    expect(modulationProgram(graph).nodes).toHaveLength(12);
  });
  test("signed offsets sum before clamping without changing authored state or undo", async () => {
    const graph = patch();
    const store = createNodeStore(graph);
    const runtime = await harness(graph);
    runtime.emit({ lfo: 1 });
    expect(runtime.values.get(paramKey(cutoff))).toBe(5623);
    expect(store.state.graph).toBe(graph);
    expect(store.state.history.past).toHaveLength(0);
    const doubled = nodeGraphSchema.parse({
      ...graph,
      edges: [...graph.edges, control("macro", "cut", "frequency", -0.25)],
    });
    runtime.delivery.sync(doubled, compile(doubled, env));
    runtime.emit({ lfo: 1, macro: 1 });
    expect(runtime.values.has(paramKey(cutoff))).toBe(false);
    runtime.emit({ lfo: 100 });
    expect(runtime.values.get(paramKey(cutoff))).toBe(20_000);
    runtime.emit({ lfo: -100 });
    expect(runtime.values.get(paramKey(cutoff))).toBe(20);
    runtime.delivery.dispose();
  });
  test("effect frequency modulation follows the logarithmic slider travel", () => {
    const effect = createDefaultEffectConfig("revamp", "eq", 0);
    const ranges = modulationParameters({
      data: { effect },
      id: "eq",
      position,
      type: "revamp",
    });
    const range = ranges.find((entry) => entry.key === "lowPassFrequency");
    if (!range) {
      throw new Error("Missing frequency range");
    }
    expect(range.scale).toBe("log");
    expect(modulatedValue(range.min, 0.5, range)).toBeCloseTo(
      Math.round(Math.sqrt(range.min * range.max) / range.step) * range.step
    );
  });
  test("Filter Q shares the logarithmic knob and MIDI range through delivery", async () => {
    const graph = patch();
    const filter = graph.nodes.find((node) => node.id === "cut");
    if (filter?.type !== "filter") {
      throw new Error("Missing Filter");
    }
    const range = modulationParameters(filter).find(
      (entry) => entry.key === "Q"
    );
    expect(range).toMatchObject({
      ...NATIVE_PARAM_RANGES.filter.find((entry) => entry.key === "Q"),
      label: "Resonance",
      max: 30,
      min: 0.1,
      scale: "log",
    });
    filter.data.Q = 0.1;
    graph.edges = graph.edges.map((edge) =>
      edge.targetHandle === "in:control:parameter"
        ? { ...edge, depth: 0.5, parameter: "Q" }
        : edge
    );
    const runtime = await harness(graph);
    runtime.emit({ lfo: 1 });
    expect(
      runtime.values.get(paramKey({ field: "Q", kind: "filter", laneId: "s" }))
    ).toBe(1.73);
    runtime.delivery.dispose();
  });
  test.each([...MODULATION_NODE_TYPES])(
    "%s reaches Web Audio, native assignments and coupled scalars",
    async (type: ModulationNodeType) => {
      const graph = patch();
      graph.edges = graph.edges.filter(
        (edge) => edge.targetHandle !== "in:control:parameter"
      );
      graph.edges.push(
        ...[
          control(type, "cut", "frequency"),
          control(type, "fx", "feedback"),
          control(type, "fx", "dryWet", -0.5),
        ].map((edge) => ({ gain: 1, muted: false, ...edge }))
      );
      const runtime = await harness(graph);
      runtime.emit({ [type]: 1 });
      expect(runtime.values.get(paramKey(cutoff))).toBe(5623);
      expect(
        runtime.values.get(
          paramKey({
            effectId: "fx",
            field: "dryWet",
            kind: "effect",
            laneId: "s",
          })
        )
      ).toBe(0.5);
      // Ordinary native fields never receive a scalar overlay; Mix does.
      expect(
        runtime.values.has(
          paramKey({
            effectId: "fx",
            field: "feedback",
            kind: "effect",
            laneId: "s",
          })
        )
      ).toBe(false);
      runtime.emit({});
      expect(runtime.values.size).toBe(0);
      runtime.delivery.dispose();
    }
  );
  test("mute, remove, source disable and fallback restore suspended targets", async () => {
    const graph = patch();
    const runtime = await harness(graph);
    runtime.emit({ lfo: 1 });
    const muted = {
      ...graph,
      edges: graph.edges.map((edge) =>
        edge.id.startsWith("lfo:") ? { ...edge, muted: true } : edge
      ),
    };
    runtime.delivery.sync(muted, compile(muted, env));
    expect(runtime.values.size).toBe(0);
    runtime.delivery.sync(graph, compile(graph, env));
    runtime.emit({ lfo: 1 });
    const disabled = setModulatorParams(graph, "lfo", { enabled: false });
    runtime.delivery.sync(disabled, compile(disabled, env));
    runtime.emit({ lfo: 1 });
    expect(runtime.values.size).toBe(0);
    runtime.delivery.sync(graph, compile(graph, env));
    runtime.emit({ lfo: 1 });
    runtime.unavailable();
    expect(runtime.values.size).toBe(0);
    expect(unappliedModulation.state["lfo:cut:frequency"]).toEqual({
      partly: false,
      why: "Nothing plays through it yet",
    });
    runtime.emit({ lfo: 1 });
    expect(runtime.values.size).toBe(0);
    // A muted cable moves nothing anyway: it isn't flagged.
    runtime.delivery.sync(muted, compile(muted, env));
    expect(unappliedModulation.state).toEqual({});
  });
  test("folded gain controls multiply together and exactly restore a quiet level", async () => {
    const graph = patch();
    graph.nodes.push({
      data: { gainDb: -80.05 },
      id: "g",
      position,
      type: "gain",
    });
    graph.edges = [
      audio("s", "g"),
      audio("g", "out"),
      control("macro", "g", "gainDb"),
      control("lfo", "s", "trimDb"),
    ].map((edge) => ({ gain: 1, muted: false, ...edge }));
    const plan = compile(graph, env);
    const runtime = await harness(graph);
    const base = plan.gains.find((entry) => entry.sources.includes("g"));
    expect(base).toBeDefined();
    if (!base) {
      throw new Error("Missing folded gain");
    }
    const gainNode = graph.nodes.find((node) => node.id === "g");
    if (!gainNode) {
      throw new Error("Missing Gain");
    }
    const [range] = modulationParameters(gainNode);
    if (!range) {
      throw new Error("Missing Gain range");
    }
    const delta = modulatedValue(-80.05, 0.25, range) + 80.05 + 9;
    runtime.emit({ lfo: 1, macro: 1 });
    expect(runtime.values.get(paramKey(base.target))).toBeCloseTo(
      base.value * 10 ** (delta / 20),
      10
    );
    runtime.emit({ lfo: 0, macro: 0 });
    expect(runtime.values.size).toBe(0);
    expect(plan.gains.find((entry) => entry.sources.includes("g"))?.value).toBe(
      base.value
    );
  });
  test("a cable reaching only some of its targets says it's partly applied", async () => {
    const graph = nodeGraphSchema.parse({
      ...patch(),
      edges: [
        audio("s", "g"),
        audio("g", "out"),
        audio("g", "p"),
        control("lfo", "g", "gainDb"),
      ],
      nodes: [
        ...patch().nodes,
        { data: { gainDb: -6 }, id: "g", position, type: "gain" },
        { data: {}, id: "p", position, type: "deviceOut" },
      ],
    });
    const plan = compile(graph, env);
    const [held, moved] = bindParam(graph, "g", "gainDb", plan).map((binding) =>
      paramKey(binding.target)
    );
    const why = "Nothing plays through it yet";
    let reached = 1;
    const runtime = await harness(graph, (target) =>
      paramKey(target) === held || (reached === 0 && paramKey(target) === moved)
        ? why
        : null
    );
    runtime.emit({ lfo: 1 });
    expect([...runtime.values.keys()]).toEqual([moved]);
    expect(unappliedModulation.state["lfo:g:gainDb"]).toEqual({
      partly: true,
      why,
    });
    // Once neither target moves, the cable isn't applied at all.
    reached = 0;
    runtime.delivery.refresh();
    expect(unappliedModulation.state["lfo:g:gainDb"]).toEqual({
      partly: false,
      why,
    });
    runtime.delivery.dispose();
  });
  test("refused handles stay inert while sources and cables past the former caps modulate", async () => {
    const graph = patch();
    const cable = graph.edges.find(
      (edge) => edge.targetHandle === "in:control:parameter"
    );
    if (!cable) {
      throw new Error("Missing modulation cable");
    }
    expect(
      parameterCables({
        ...graph,
        edges: [{ ...cable, sourceHandle: "out:control:missing" }],
      })
    ).toEqual([]);
    const overflow = {
      ...graph,
      edges: [
        ...Array.from({ length: 64 }, (_, index) => ({
          ...cable,
          id: String(index),
          sourceHandle: "out:control:missing",
        })),
        cable,
      ],
    };
    expect(parameterCables(overflow)).toHaveLength(1);
    const nodes = {
      ...graph,
      edges: [
        ...graph.edges.filter((edge) => edge !== cable),
        { ...cable, source: "extra-20" },
      ],
      nodes: [
        ...graph.nodes,
        ...Array.from({ length: 21 }, (_, index) =>
          palette("curve", `extra-${index}`)
        ),
      ],
    };
    expect(parameterCables(nodes)).toHaveLength(1);
    const runtime = await harness(nodes);
    runtime.emit({ "extra-20": 1 });
    expect(runtime.values.size).toBeGreaterThan(0);
  });
});

test("commits retain surviving overlays and clear only removed physical keys", async () => {
  const graph = patch();
  const h = await harness(graph);
  h.emit({ lfo: 1 });
  const value = h.values.get(paramKey(cutoff));
  h.delivery.sync({ ...graph }, compile(graph, env));
  expect(h.cleared).toEqual([]);
  expect(h.values.get(paramKey(cutoff))).toBe(value);
  const disconnected = {
    ...graph,
    edges: graph.edges.filter(
      (edge) => edge.targetHandle !== "in:control:parameter"
    ),
  };
  h.delivery.sync(disconnected, compile(disconnected, env));
  expect(h.cleared).toEqual([paramKey(cutoff)]);
  expect(h.values.size).toBe(0);
});

test.each(["delay", "werkstatt"] as const)(
  "%s unresolved targets mark their cable unavailable",
  async (type) => {
    const graph = patch();
    const field = type === "delay" ? "feedback" : "dryWet";
    const config = createDefaultEffectConfig(type, "fx", 0);
    graph.nodes = nodeGraphSchema.parse({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === "fx" ? { ...node, data: { effect: config }, type } : node
      ),
    }).nodes;
    graph.edges = graph.edges.map((edge) =>
      edge.targetHandle === "in:control:parameter"
        ? { ...edge, parameter: field, target: "fx" }
        : edge
    );
    const owner = createParameters({
      active: () => true,
      audio: {
        getEffectsRuntimeOutcome: () => ({
          backend: "official",
          ready: true,
          status: "ready",
        }),
        getStripNodes: () => null,
        hasEffectModulationField: () => false,
      },
      effects: { setEffectFields: () => "applied" },
      plan: () => ({ backend: "official", effects: [config] }),
      soundId: "live-sound",
    });
    const h = await harness(graph, owner.unavailable);
    // Delivery and the cable's "not applied" read the same reason.
    expect(unappliedModulation.state["lfo:cut:frequency"]).toEqual({
      partly: false,
      why:
        type === "delay"
          ? "openDAW has no control for this here"
          : "Werkstatt isn't available yet",
    });
    h.emit({ lfo: 1 });
    expect(h.values.size).toBe(0);
  }
);
