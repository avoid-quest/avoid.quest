import { describe, expect, test } from "bun:test";
import { compile } from "./compile";
import { curveAt } from "./modulation-curve";
import { ModulationDsp, modulationFrequency } from "./modulation-dsp";
import { nativeModulationNodes } from "./modulation-native";
import {
  applyModulation,
  modulatedValue,
  modulationParameters,
  setModulatorParams,
} from "./modulation-parameters";
import { modulationProgram } from "./modulation-runtime";
import {
  MODULATION_DATA_SCHEMAS,
  MODULATION_NODE_TYPES,
  type ModulationNodeType,
  type ModulationSpec,
} from "./modulation-schema";
import { commitNodeGraph, createNodeStore, undoNodeGraph } from "./node-store";
import { createPaletteNode } from "./palette";
import { type NodeGraph, nodeGraphSchema } from "./schema";
import { validate } from "./validate";

function source(
  type: ModulationNodeType,
  data: Record<string, unknown> = {},
  id = type
): ModulationSpec {
  return {
    data: MODULATION_DATA_SCHEMAS[type].parse(data),
    id,
    type,
  } as ModulationSpec;
}

function dsp(...nodes: ModulationSpec[]) {
  const engine = new ModulationDsp(1000);
  engine.configure({
    followers: nodes
      .filter((node) => node.type === "follower")
      .map((node) => node.id),
    links: [],
    nodes,
  });
  return engine;
}

function patch(): NodeGraph {
  return nodeGraphSchema.parse({
    edges: [
      {
        id: "audio",
        source: "station",
        sourceHandle: "out:audio:main",
        target: "cut",
        targetHandle: "in:audio:main",
      },
      {
        id: "output",
        source: "cut",
        sourceHandle: "out:audio:main",
        target: "speakers",
        targetHandle: "in:audio:main",
      },
      {
        id: "tap",
        source: "station",
        sourceHandle: "out:audio:main",
        target: "follower",
        targetHandle: "in:audio:main",
      },
      {
        depth: 0.25,
        id: "mod",
        parameter: "frequency",
        source: "lfo",
        sourceHandle: "out:control:main",
        target: "cut",
        targetHandle: "in:control:parameter",
      },
    ],
    nodes: [
      {
        data: {
          radio: { name: "Test", streamUrl: "https://example.com/a.mp3" },
        },
        id: "station",
        position: { x: 0, y: 0 },
        type: "station",
      },
      { data: {}, id: "cut", position: { x: 400, y: 0 }, type: "filter" },
      { id: "speakers", position: { x: 800, y: 0 }, type: "speakers" },
      ...MODULATION_NODE_TYPES.map((type) =>
        createPaletteNode(type, type, { x: 0, y: 200 })
      ),
    ],
    version: 2,
  });
}

describe("Node modulation routing", () => {
  test("every source ships, persists defaults, and leaves audio lanes intact", () => {
    const graph = patch();
    expect(nodeGraphSchema.parse(JSON.parse(JSON.stringify(graph)))).toEqual(
      graph
    );
    expect(validate(graph)).toEqual([]);
    const plan = compile(graph, {
      crossOriginIsolated: true,
      profile: "desktop",
    });
    expect(plan.issues).toEqual([]);
    expect([...plan.lanes.keys()]).toEqual(["station"]);
    expect(plan.lanes.get("station")?.filter?.frequency).toBe(1000);
    expect(modulationProgram(graph).nodes).toHaveLength(12);
    expect(modulationProgram(graph).audioSources).toEqual({
      follower: "station",
    });
  });

  test("offsets sum in normalized space, clamp and never alter the document or undo", () => {
    const graph = patch();
    const store = createNodeStore(graph);
    const effective = applyModulation(graph, { lfo: 1 });
    expect(
      compile(effective, { crossOriginIsolated: true }).lanes.get("station")
        ?.filter?.frequency
    ).toBe(5623);
    expect(store.state.graph).toBe(graph);
    expect(store.state.history.past).toHaveLength(0);
    const doubled = {
      ...graph,
      edges: [
        ...graph.edges,
        { ...graph.edges[3], depth: -0.25, id: "second" },
      ],
    } as NodeGraph;
    expect(
      compile(applyModulation(doubled, { lfo: 1 }), {
        crossOriginIsolated: true,
      }).lanes.get("station")?.filter?.frequency
    ).toBe(1000);
    const cut = graph.nodes.find((node) => node.id === "cut");
    if (!cut) {
      throw new Error("Missing test Filter");
    }
    const [range] = modulationParameters(cut);
    if (!range) {
      throw new Error("Missing test Cutoff");
    }
    expect(modulatedValue(1000, 4, range)).toBe(20_000);
    expect(modulatedValue(1000, -4, range)).toBe(20);
    expect(applyModulation(graph, {})).toBe(graph);
    expect(
      applyModulation(setModulatorParams(graph, "lfo", { enabled: false }), {
        lfo: 1,
      }).nodes.find((node) => node.id === "cut")?.data
    ).toEqual(graph.nodes.find((node) => node.id === "cut")?.data);
  });

  test("authored edits undo; unsupported targets and control cycles fail closed", () => {
    const store = createNodeStore(patch());
    commitNodeGraph(
      (graph) => setModulatorParams(graph, "macro", { value: 0.8 }),
      store,
      "snapshot"
    );
    undoNodeGraph(store);
    expect(
      store.state.graph?.nodes.find((node) => node.id === "macro")?.data
    ).toMatchObject({ value: 0.5 });
    const invalid = patch();
    const [, , , cable] = invalid.edges;
    if (!cable) {
      throw new Error("Missing test cable");
    }
    cable.parameter = "enabled";
    expect(validate(invalid)).toContainEqual(
      expect.objectContaining({ code: "modulation-target" })
    );
    invalid.edges.push(
      {
        gain: 1,
        id: "a",
        muted: false,
        source: "lfo",
        sourceHandle: "out:control:main",
        target: "shapedLfo",
        targetHandle: "in:control:gate",
      },
      {
        gain: 1,
        id: "b",
        muted: false,
        source: "shapedLfo",
        sourceHandle: "out:control:main",
        target: "lfo",
        targetHandle: "in:control:gate",
      }
    );
    expect(validate(invalid)).toContainEqual(
      expect.objectContaining({ code: "control-cycle" })
    );
    expect(modulationProgram(invalid).links).toHaveLength(1);
  });
});

describe("sample-clocked modulation sources", () => {
  test("native generators are preferred; trigger extensions keep their DSP path", () => {
    const program = modulationProgram(patch());
    expect(
      nativeModulationNodes(program, new Set()).map((node) => node.type)
    ).toEqual(["macro", "lfo", "steps", "randomiser"]);
    expect(
      nativeModulationNodes(program, new Set(["lfo"])).map((node) => node.type)
    ).toEqual(["macro", "steps", "randomiser"]);
    program.links.push({ depth: 1, source: "clock", target: "steps" });
    program.nodes = program.nodes.map((node) =>
      node.type === "lfo" ? source("lfo", { delay: 1 }) : node
    );
    expect(
      nativeModulationNodes(program, new Set()).map((node) => node.type)
    ).toEqual(["macro", "randomiser"]);
  });

  test("native telemetry is already folded and feeds downstream control without a second range transform", () => {
    const engine = new ModulationDsp(1000);
    engine.configure({
      followers: [],
      links: [{ depth: 1, source: "macro", target: "slew" }],
      nativeIds: ["macro"],
      nodes: [
        source("macro", { amount: 0.2, bipolar: true, value: 0.8 }),
        source("slew", { time: 0.1 }),
      ],
    });
    engine.setNativeValues({ macro: 0.7 });
    expect(engine.process([], 100).macro).toBe(0.7);
    expect(engine.values.slew).toBeCloseTo(0.7 * (1 - Math.exp(-1)), 3);
    engine.configure({
      followers: [],
      links: [],
      nativeIds: ["macro"],
      nodes: [source("macro", { enabled: false })],
    });
    expect(engine.process([], 1).macro).toBe(0);
    engine.configure({
      followers: [],
      links: [],
      nodes: [source("macro", { value: 0.8 })],
    });
    expect(engine.process([], 1).macro).toBe(0.8);
  });

  test("LFO shapes, bend, delay/fade and sync produce bounded movement", () => {
    expect(modulationFrequency({ rate: 0, sync: "1/4", tempo: 120 })).toBe(2);
    expect(modulationFrequency({ rate: 1, sync: "1/4", tempo: 120 })).toBe(3);
    for (const shape of ["sine", "triangle", "sawUp", "sawDown", "square"]) {
      const engine = dsp(source("lfo", { bend: 0.3, shape }));
      const first = engine.process([], 100).lfo;
      const second = engine.process([], 400).lfo;
      expect(first).not.toBe(second);
      expect(Math.abs(first)).toBeLessThanOrEqual(1);
      expect(Math.abs(second)).toBeLessThanOrEqual(1);
    }
    const delayed = dsp(source("lfo", { delay: 0.2, fade: 0.2 }));
    expect(delayed.process([], 100).lfo).toBeCloseTo(0);
    expect(Math.abs(delayed.process([], 200).lfo)).toBeLessThan(0.5);
    const tidal = dsp(source("shapedLfo"));
    expect(tidal.process([], 200).shapedLfo).not.toBe(
      tidal.process([], 300).shapedLfo
    );
  });

  test("steps move through the pattern; random seeds, loops and quantization repeat", () => {
    const steps = dsp(
      source("steps", { rate: 4, smooth: 0, values: [0, 1, 0.25] })
    );
    expect(steps.process([], 100).steps).toBe(0);
    expect(steps.process([], 250).steps).toBe(1);
    expect(steps.process([], 250).steps).toBe(0.25);
    const first = dsp(
      source("randomiser", { levels: 4, loop: 3, seed: 42, smooth: 0 })
    );
    const second = dsp(
      source("randomiser", { levels: 4, loop: 3, seed: 42, smooth: 0 })
    );
    const value = first.process([], 50).randomiser;
    expect(second.process([], 50).randomiser).toBe(value);
    expect(first.process([], 3000).randomiser).toBe(value);
    expect([0, 1 / 3, 2 / 3, 1]).toContain(value);
  });

  test("ADSR attacks, sustains and releases; multi-stage holds and completes", () => {
    const envelope = dsp(
      source("envelope", {
        attack: 0.05,
        decay: 0.05,
        release: 0.05,
        sustain: 0.4,
      })
    );
    expect(envelope.process([], 50).envelope).toBe(0);
    envelope.gate("envelope", true);
    expect(envelope.process([], 300).envelope).toBeCloseTo(0.4, 2);
    envelope.gate("envelope", false);
    expect(envelope.process([], 300).envelope).toBeCloseTo(0, 3);
    const multi = dsp(source("multiEnvelope", { duration: 1 }));
    multi.gate("multiEnvelope", true);
    expect(multi.process([], 700).multiEnvelope).toBeCloseTo(0.8, 3);
    multi.gate("multiEnvelope", false);
    expect(multi.process([], 700).multiEnvelope).toBe(0);
  });

  test("curves loop or trigger once, and bends alter interpolation", () => {
    const curve = source("curve", { duration: 1, loop: false });
    const engine = dsp(curve);
    expect(engine.process([], 500).curve).toBe(0);
    engine.gate("curve", true);
    expect(engine.process([], 250).curve).toBeGreaterThan(0.99);
    engine.gate("curve", false);
    expect(engine.process([], 1000).curve).toBe(0);
    expect(
      curveAt(
        [
          { bend: 0, time: 0, value: 0 },
          { bend: 0, time: 1, value: 1 },
        ],
        0.5
      )
    ).toBe(0.5);
    expect(
      curveAt(
        [
          { bend: 1, time: 0, value: 0 },
          { bend: 0, time: 1, value: 1 },
        ],
        0.5
      )
    ).toBeLessThan(0.01);
  });

  test("slew follows upstream control smoothly in the same render block", () => {
    const engine = new ModulationDsp(1000);
    engine.configure({
      followers: [],
      links: [{ depth: 1, source: "macro", target: "slew" }],
      nodes: [source("slew", { time: 0.1 }), source("macro", { value: 1 })],
    });
    expect(engine.process([], 100).slew).toBeCloseTo(1 - Math.exp(-1), 3);
    expect(engine.process([], 500).slew).toBeGreaterThan(0.99);
  });

  test("follower detects stereo energy and releases when its input disappears", () => {
    const engine = dsp(
      source("follower", { attack: 0.01, release: 0.1, sensitivity: 2 })
    );
    const left = new Float32Array(1000).fill(0.25);
    const right = new Float32Array(1000).fill(-0.25);
    expect(engine.process([[left, right]], 1000).follower).toBeCloseTo(0.5, 2);
    expect(engine.process([], 1000).follower).toBeLessThan(0.001);
  });

  test("clock gates an envelope; MIDI respects channel and releases overlapping notes", () => {
    const engine = new ModulationDsp(1000);
    engine.configure({
      followers: [],
      links: [{ depth: 1, source: "clock", target: "envelope" }],
      nodes: [source("envelope"), source("clock", { rate: 2 })],
    });
    expect(engine.process([], 150).envelope).toBeGreaterThan(0);
    const midi = dsp(source("midiIn", { channel: 1, mode: "gate" }));
    midi.midi([0x90, 60, 100]);
    expect(midi.process([], 1).midiIn).toBe(0);
    midi.midi([0x91, 60, 100]);
    midi.midi([0x91, 64, 100]);
    expect(midi.process([], 1).midiIn).toBe(1);
    midi.midi([0x81, 64, 0]);
    expect(midi.process([], 1).midiIn).toBe(1);
    midi.midi([0x91, 60, 0]);
    expect(midi.process([], 1).midiIn).toBe(0);
    midi.midi([0x91, 60, 100]);
    midi.midi([255]);
    expect(midi.process([], 1).midiIn).toBe(0);
  });
});
