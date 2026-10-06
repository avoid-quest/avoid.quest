import { describe, expect, test } from "bun:test";
import { compile } from "./compile";
import { curveAt } from "./modulation-curve";
import { ModulationDsp, modulationFrequency } from "./modulation-dsp";
import { nativeModulationNodes } from "./modulation-native";
import {
  applyModulation,
  modulatedValue,
  modulationParameters,
  NATIVE_PARAM_RANGES,
  parameterCables,
  setModulatorParams,
} from "./modulation-parameters";
import { modulationProgram, routedControlValues } from "./modulation-runtime";
import {
  MODULATION_DATA_SCHEMAS,
  MODULATION_NODE_TYPES,
  type ModulationNodeType,
  type ModulationSpec,
} from "./modulation-schema";
import { commitNodeGraph, createNodeStore, undoNodeGraph } from "./node-store";
import { createPaletteNode } from "./palette";
import { type NodeGraph, nodeGraphSchema } from "./schema";
import { NODE_BUDGETS, validate } from "./validate";

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
    expect(
      (plan.patch?.nodes.get("cut")?.data as { frequency: number } | undefined)
        ?.frequency
    ).toBe(1000);
    expect(modulationProgram(graph).nodes).toHaveLength(12);
    expect(modulationProgram(graph).audioSources).toEqual({
      follower: "follower",
    });
  });

  test("offsets sum in normalized space, clamp and never alter the document or undo", () => {
    const graph = patch();
    const store = createNodeStore(graph);
    const effective = applyModulation(graph, { lfo: 1 });
    expect(
      (
        compile(effective, { crossOriginIsolated: true }).patch?.nodes.get(
          "cut"
        )?.data as { frequency: number } | undefined
      )?.frequency
    ).toBe(5623);
    expect(store.state.graph).toBe(graph);
    expect(store.state.history.past).toHaveLength(0);
    const doubled = {
      ...graph,
      edges: [
        ...graph.edges,
        { ...graph.edges[3], depth: -0.25, id: "second", source: "macro" },
      ],
    } as NodeGraph;
    expect(
      (
        compile(applyModulation(doubled, { lfo: 1, macro: 1 }), {
          crossOriginIsolated: true,
        }).patch?.nodes.get("cut")?.data as { frequency: number } | undefined
      )?.frequency
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

  test("zero offsets preserve quiet Gain values and unchanged graph identity", () => {
    const graph = nodeGraphSchema.parse({
      edges: [
        {
          id: "amount",
          source: "macro",
          sourceHandle: "out:control:main",
          target: "gain",
          targetHandle: "in:control:parameter",
        },
      ],
      nodes: [
        createPaletteNode("macro", "macro", { x: 0, y: 0 }),
        {
          data: { gainDb: -80.05 },
          id: "gain",
          position: { x: 0, y: 0 },
          type: "gain",
        },
        { id: "speakers", position: { x: 0, y: 0 }, type: "speakers" },
      ],
      version: 2,
    });
    const gain = graph.nodes.find((node) => node.type === "gain");
    if (!gain) {
      throw new Error("Missing test Gain");
    }
    const [range] = modulationParameters(gain);
    expect(range?.min).toBe(-80.05);
    expect(applyModulation(graph, { macro: 0 })).toBe(graph);
    expect(
      applyModulation(graph, { macro: 1 }).nodes.find(
        (node) => node.type === "gain"
      )?.data
    ).toMatchObject({ gainDb: -54 });
  });

  test("Filter Q uses the same logarithmic range as its knob and MIDI", () => {
    const graph = patch();
    const filter = graph.nodes.find((node) => node.id === "cut");
    if (!filter) {
      throw new Error("Missing test Filter");
    }
    const resonance = modulationParameters(filter).find(
      (range) => range.key === "Q"
    );
    const nativeRange = NATIVE_PARAM_RANGES.filter.find(
      (range) => range.key === "Q"
    );
    expect(resonance).toMatchObject({ max: 30, min: 0.1, scale: "log" });
    expect(resonance).toMatchObject({ ...nativeRange, label: "Resonance" });
    if (!resonance) {
      throw new Error("Missing resonance range");
    }
    expect(modulatedValue(0.1, 0.5, resonance)).toBe(1.73);
  });

  test("refused source handles and cables past the budget never change targets", () => {
    const graph = patch();
    const [, , , cable] = graph.edges;
    if (!cable) {
      throw new Error("Missing test cable");
    }
    const invalid = {
      ...graph,
      edges: [{ ...cable, sourceHandle: "out:control:missing" }],
    };
    expect(parameterCables(invalid)).toEqual([]);
    expect(applyModulation(invalid, { lfo: 1 })).toBe(invalid);
    const overflow = {
      ...graph,
      edges: [
        ...Array.from({ length: 64 }, (_, index) => ({
          ...cable,
          id: `invalid-${index}`,
          sourceHandle: "out:control:missing",
        })),
        cable,
      ],
    };
    expect(validate(overflow)).toContainEqual(
      expect.objectContaining({ code: "budget-edges", id: cable.id })
    );
    expect(parameterCables(overflow)).toEqual([]);
    expect(applyModulation(overflow, { lfo: 1 })).toBe(overflow);
  });

  test("a wired parameter cable from a modulator past the node budget is inert", () => {
    const graph = patch();
    const [, , , cable] = graph.edges;
    if (!cable) {
      throw new Error("Missing test cable");
    }
    const overflow = nodeGraphSchema.parse({
      ...graph,
      edges: [{ ...cable, source: "extra-20" }],
      nodes: [
        ...graph.nodes,
        ...Array.from({ length: 21 }, (_, index) =>
          createPaletteNode("macro", `extra-${index}`, { x: 0, y: 0 })
        ),
      ],
    });
    expect(validate(overflow)).toContainEqual(
      expect.objectContaining({ code: "budget-modulators", id: "extra-20" })
    );
    expect(parameterCables(overflow)).toEqual([]);
    expect(applyModulation(overflow, { "extra-20": 1 })).toBe(overflow);
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

describe("control merge and split routing", () => {
  test("unwired, audio-only and isolated routers stay off the render thread", () => {
    const graph = nodeGraphSchema.parse({
      edges: [
        {
          id: "audio",
          source: "audio-merge",
          sourceHandle: "out:audio:main",
          target: "audio-split",
          targetHandle: "in:audio:main",
        },
        {
          id: "island",
          source: "island-merge",
          sourceHandle: "out:control:main",
          target: "island-split",
          targetHandle: "in:control:main",
        },
      ],
      nodes: [
        {
          ...createPaletteNode("macro", "macro", { x: 0, y: 0 }),
          data: { value: 0.75 },
        },
        createPaletteNode("speakers", "speakers", { x: 0, y: 0 }),
        ...["audio", "island"].flatMap((prefix) => [
          createPaletteNode("merge", `${prefix}-merge`, { x: 0, y: 0 }),
          createPaletteNode("fxComposite", `${prefix}-split`, { x: 0, y: 0 }),
        ]),
        ...Array.from({ length: 1000 }, (_, index) =>
          createPaletteNode(
            index % 2 ? "merge" : "fxComposite",
            `unused-${index}`,
            {
              x: 0,
              y: 0,
            }
          )
        ),
      ],
      version: 2,
    });
    expect(validate(graph)).toEqual([]);
    const program = modulationProgram(graph);
    expect(program.routers).toEqual([]);
    const engine = new ModulationDsp(1000);
    engine.configure(program);
    expect(engine.process([], 128)).toEqual({ macro: 0.75 });
  });

  test("only routers on accepted cables enter the executable program", () => {
    const budget = NODE_BUDGETS.desktop.edges;
    const graph = nodeGraphSchema.parse({
      edges: Array.from({ length: budget + 100 }, (_, index) => ({
        id: `cable-${index}`,
        source: "macro",
        sourceHandle: "out:control:main",
        target: `merge-${index}`,
        targetHandle: "in:control:main",
      })),
      nodes: [
        createPaletteNode("macro", "macro", { x: 0, y: 0 }),
        createPaletteNode("speakers", "speakers", { x: 0, y: 0 }),
        ...Array.from({ length: budget + 100 }, (_, index) =>
          createPaletteNode("merge", `merge-${index}`, { x: 0, y: 0 })
        ),
      ],
      version: 2,
    });
    const program = modulationProgram(graph);
    expect(program.routers).toHaveLength(budget);
    expect(program.links).toHaveLength(budget);
    const engine = new ModulationDsp(1000);
    engine.configure(program);
    const values = engine.process([], 128);
    expect(Object.keys(values)).toHaveLength(budget + 1);
    expect(values[`merge-${budget - 1}`]).toBe(0.5);
    expect(values[`merge-${budget}`]).toBeUndefined();
  });

  test("muted, invalid and refused-source cables do not activate routers", () => {
    const graph = nodeGraphSchema.parse({
      ...patch(),
      edges: [
        {
          id: "refused-source",
          source: "extra-20",
          sourceHandle: "out:control:main",
          target: "sum",
          targetHandle: "in:control:main",
        },
        {
          id: "muted",
          muted: true,
          source: "macro",
          sourceHandle: "out:control:main",
          target: "sum",
          targetHandle: "in:control:main",
        },
        {
          id: "invalid-target",
          parameter: "not-a-knob",
          source: "sum",
          sourceHandle: "out:control:main",
          target: "cut",
          targetHandle: "in:control:parameter",
        },
      ],
      nodes: [
        ...patch().nodes,
        ...Array.from({ length: 21 }, (_, index) =>
          createPaletteNode("macro", `extra-${index}`, { x: 0, y: 0 })
        ),
        createPaletteNode("merge", "sum", { x: 0, y: 0 }),
      ],
    });
    const program = modulationProgram(graph);
    expect(program.nodes).toHaveLength(32);
    expect(program.routers).toEqual([]);
    expect(program.links).toEqual([]);
  });

  test("routers preserve same-sample Slew and gate inputs", () => {
    const graph = nodeGraphSchema.parse({
      edges: [
        {
          id: "input",
          source: "macro",
          sourceHandle: "out:control:main",
          target: "sum",
          targetHandle: "in:control:main",
        },
        {
          id: "split",
          source: "sum",
          sourceHandle: "out:control:main",
          target: "split",
          targetHandle: "in:control:main",
        },
        {
          id: "slew",
          source: "split",
          sourceHandle: "out:control:branch-1",
          target: "slew",
          targetHandle: "in:control:main",
        },
        {
          id: "gate",
          source: "split",
          sourceHandle: "out:control:branch-2",
          target: "envelope",
          targetHandle: "in:control:gate",
        },
      ],
      nodes: [
        {
          ...createPaletteNode("macro", "macro", { x: 0, y: 0 }),
          data: { value: 0.75 },
        },
        createPaletteNode("speakers", "speakers", { x: 0, y: 0 }),
        createPaletteNode("slew", "slew", { x: 0, y: 0 }),
        createPaletteNode("envelope", "envelope", { x: 0, y: 0 }),
        createPaletteNode("merge", "sum", { x: 0, y: 0 }),
        createPaletteNode("fxComposite", "split", { x: 0, y: 0 }),
      ],
      version: 2,
    });
    expect(validate(graph)).toEqual([]);
    const engine = new ModulationDsp(1000);
    engine.configure(modulationProgram(graph));
    const values = engine.process([], 10);
    expect(values.sum).toBe(0.75);
    expect(values.split).toBe(0.75);
    expect(values.slew).toBeGreaterThan(0);
    expect(values.envelope).toBeGreaterThan(0);
  });

  test("a Split parameter assignment never becomes a control signal input", () => {
    const graph = nodeGraphSchema.parse({
      edges: [
        {
          depth: -0.25,
          id: "parameter",
          parameter: "dryWet",
          source: "macro",
          sourceHandle: "out:control:main",
          target: "split",
          targetHandle: "in:control:parameter",
        },
        {
          id: "signal",
          source: "split",
          sourceHandle: "out:control:branch-1",
          target: "slew",
          targetHandle: "in:control:main",
        },
      ],
      nodes: [
        {
          ...createPaletteNode("macro", "macro", { x: 0, y: 0 }),
          data: { value: 0.75 },
        },
        createPaletteNode("slew", "slew", { x: 0, y: 0 }),
        createPaletteNode("speakers", "speakers", { x: 0, y: 0 }),
        createPaletteNode("fxComposite", "split", { x: 0, y: 0 }),
      ],
      version: 2,
    });
    expect(validate(graph)).toEqual([]);
    const program = modulationProgram(graph);
    const engine = new ModulationDsp(1000);
    engine.configure(program);
    const values = engine.process([], 10);
    expect(values.split).toBe(0);
    expect(values.slew).toBe(0);
    expect(program.links).toEqual([
      { depth: 1, source: "split", target: "slew" },
    ]);
    expect(
      applyModulation(graph, values).nodes.find((node) => node.id === "split")
        ?.data
    ).toMatchObject({ effect: { dryWet: 0.81 } });
  });

  function routed(): NodeGraph {
    const graph = patch();
    return nodeGraphSchema.parse({
      ...graph,
      edges: [
        ...graph.edges.filter((edge) => edge.id !== "mod"),
        {
          depth: 0.5,
          id: "a",
          source: "macro",
          sourceHandle: "out:control:main",
          target: "sum",
          targetHandle: "in:control:main",
        },
        {
          depth: -0.25,
          id: "b",
          source: "lfo",
          sourceHandle: "out:control:main",
          target: "sum",
          targetHandle: "in:control:main",
        },
        {
          id: "c",
          source: "sum",
          sourceHandle: "out:control:main",
          target: "split",
          targetHandle: "in:control:main",
        },
        {
          depth: 0.5,
          id: "d",
          parameter: "frequency",
          source: "split",
          sourceHandle: "out:control:branch-1",
          target: "cut",
          targetHandle: "in:control:parameter",
        },
        {
          depth: 0.25,
          id: "e",
          parameter: "trimDb",
          source: "split",
          sourceHandle: "out:control:branch-2",
          target: "station",
          targetHandle: "in:control:parameter",
        },
      ],
      nodes: [
        ...graph.nodes,
        createPaletteNode("merge", "sum", { x: 200, y: 200 }),
        createPaletteNode("fxComposite", "split", { x: 400, y: 200 }),
      ],
    });
  }
  test("routers sum signed inputs and fan out to independent parameter assignments", () => {
    const graph = routed();
    expect(validate(graph)).toEqual([]);
    const program = modulationProgram(graph);
    const engine = new ModulationDsp(1000);
    engine.configure(program);
    engine.process([], 1);
    expect(engine.values.sum).toBeCloseTo(
      engine.values.macro * 0.5 - engine.values.lfo * 0.25
    );
    expect(engine.values.split).toBe(engine.values.sum);
    const values = routedControlValues(program, { lfo: 0, macro: 1 });
    expect(values.sum).toBe(0.5);
    expect(values.split).toBe(0.5);
    const effective = applyModulation(graph, values);
    expect(effective.nodes.find((node) => node.id === "cut")?.data).not.toEqual(
      graph.nodes.find((node) => node.id === "cut")?.data
    );
    expect(
      effective.nodes.find((node) => node.id === "station")?.data
    ).not.toEqual(graph.nodes.find((node) => node.id === "station")?.data);
  });
  test("removing or muting router inputs clears old outputs even while the worklet is suspended", () => {
    const graph = routed();
    const old = { lfo: 0, macro: 1, split: 0.5, sum: 0.5 };
    const removed = {
      ...graph,
      edges: graph.edges.filter((edge) => !["a", "b"].includes(edge.id)),
    };
    const values = routedControlValues(modulationProgram(removed), old);
    expect(values.sum).toBe(0);
    expect(values.split).toBe(0);
    expect(applyModulation(removed, values)).toEqual(removed);
    const muted = {
      ...graph,
      edges: graph.edges.map((edge) => ({ ...edge, muted: true })),
    };
    const mutedValues = routedControlValues(modulationProgram(muted), old);
    expect(mutedValues).not.toHaveProperty("split");
    expect(applyModulation(muted, mutedValues)).toEqual(muted);
  });
  test("invalid parameter cables cannot bypass validation during modulation", () => {
    const graph = routed();
    const invalid = {
      ...graph,
      edges: graph.edges.map((edge) =>
        edge.id === "d"
          ? { ...edge, parameter: "not-a-knob" }
          : { ...edge, muted: true }
      ),
    };
    expect(applyModulation(invalid, { split: 1 })).toEqual(invalid);
  });
});
