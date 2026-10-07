import { describe, expect, test } from "bun:test";
import {
  MAX_CONTROL_COLUMNS,
  moduleWidth,
} from "@/components/radio/node/module-frame";
import type { Radio } from "@/lib/audio/playback/types";
import { isSplitNode } from "./branches";
import { createNodeEffectConfig } from "./catalogue";
import { compile } from "./compile";
import {
  addStationNode,
  connectNodes,
  DUPLICATE_OFFSET_PX,
  duplicateNodes,
  findStationNode,
  freshNodeId,
  type GraphEdit,
  insertNodeOnEdge,
  moveNodes,
  nextFxPosition,
  nextOutputPosition,
  nextStationPosition,
  reconnectEdge,
  removeEdges,
  removeNodes,
  removeNodesHealed,
  removeSelection,
  setDeviceParams,
  setEffectParams,
  setNativeParams,
  setStationRadio,
  setStationsEnabled,
  setViewport,
  swapEffect,
  syncStationSnapshots,
  toggleBypass,
} from "./graph-edits";
import { commitNodeGraph, createNodeStore, undoNodeGraph } from "./node-store";
import { addPaletteNode, createPaletteNode } from "./palette";
import { diff } from "./reconcile";
import {
  DEFAULT_INPUT_STRIP,
  type EffectNodeType,
  type NodeGraph,
  type NodeType,
  nodeGraphSchema,
} from "./schema";
import { seriesToParallel } from "./series-parallel";
import { forgetLocalFileUrls, localFileRadio } from "./sources";
import {
  buildNodeGraphFromTemplate,
  SPEAKERS_NODE_ID,
  STARTER_STATION_ID,
  STATION_ROW_HEIGHT,
} from "./templates";
import { validate } from "./validate";

function radio(id: string, extra: Partial<Radio> = {}): Radio {
  return {
    enabled: true,
    id,
    name: `Station ${id}`,
    streamUrl: `https://radio.example/${id}.mp3`,
    ...extra,
  };
}

function patch(...radios: Radio[]) {
  return buildNodeGraphFromTemplate("start-from-multiple", { saved: radios });
}

const ENV = { crossOriginIsolated: false };

/** The widest FX body the canvas draws: four knob columns. */
const WIDEST_FX = moduleWidth(MAX_CONTROL_COLUMNS, 1);

function accepted(edit: GraphEdit): NodeGraph {
  if (!edit.ok) {
    throw new Error(edit.message);
  }
  return edit.graph;
}

function modulationPatch(): NodeGraph {
  const position = { x: 0, y: 0 };
  return nodeGraphSchema.parse({
    edges: [
      {
        depth: -0.5,
        id: "control",
        parameter: "Q",
        source: "macro",
        sourceHandle: "out:control:main",
        target: "filter",
        targetHandle: "in:control:parameter",
      },
    ],
    nodes: [
      { id: "macro", position, type: "macro" },
      { id: "other-macro", position, type: "macro" },
      { data: {}, id: "filter", position, type: "filter" },
      { data: {}, id: "pan", position, type: "pan" },
      { id: "slew", position, type: "slew" },
      { id: "speakers", position, type: "speakers" },
    ],
    version: 2,
  });
}

describe("addStationNode", () => {
  test("adds a Station below the others, wired to Speakers", () => {
    const { graph, nodeId } = addStationNode(patch(radio("a")), radio("b"));

    expect(nodeId).toBe("src-b");
    const added = graph.nodes.find((node) => node.id === "src-b");
    expect(added?.position).toEqual({ x: 0, y: STATION_ROW_HEIGHT });
    expect(graph.edges.at(-1)).toMatchObject({
      source: "src-b",
      sourceHandle: "out:audio:main",
      target: SPEAKERS_NODE_ID,
      targetHandle: "in:audio:main",
    });
    expect(validate(graph)).toEqual([]);
    expect([...compile(graph, ENV).lanes.keys()]).toEqual(["src-a", "src-b"]);
  });

  test("reuses the Station already holding that radio", () => {
    const start = patch(radio("a"));
    const { graph, nodeId } = addStationNode(start, radio("a"));

    expect(graph).toBe(start);
    expect(nodeId).toBe("src-a");
  });

  test("fills the Starter's empty slot instead of adding beside it", () => {
    const starter = buildNodeGraphFromTemplate("starter");
    const { graph, nodeId } = addStationNode(starter, radio("a"));

    expect(nodeId).toBe(STARTER_STATION_ID);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual(starter.edges);
    expect(findStationNode(graph, radio("a"))?.id).toBe(STARTER_STATION_ID);
    expect([...compile(graph, ENV).lanes.keys()]).toEqual([STARTER_STATION_ID]);

    // Once filled, the next search adds a second Station.
    const next = addStationNode(graph, radio("b"));
    expect(next.nodeId).toBe("src-b");
    expect(next.graph.nodes).toHaveLength(3);
  });

  test("leaves an empty slot that feeds an effect alone", () => {
    const duck = buildNodeGraphFromTemplate("duck");
    const { graph, nodeId } = addStationNode(duck, radio("a"));

    expect(nodeId).toBe("src-a");
    expect(graph.nodes).toHaveLength(duck.nodes.length + 1);
  });

  test("puts the first Station one column left of Speakers", () => {
    const blank = buildNodeGraphFromTemplate("blank");
    const { graph } = addStationNode(blank, radio("a"));
    const [speakers] = blank.nodes;

    expect(graph.nodes.at(-1)?.position).toEqual({
      x: (speakers?.position.x ?? 0) - 480,
      y: speakers?.position.y ?? 0,
    });
  });
});

describe("freshNodeId", () => {
  test("still mints ids where crypto.randomUUID is missing", () => {
    const original = globalThis.crypto;
    // As in Safari before 15.4, or a page served over plain http.
    globalThis.crypto = {} as Crypto;
    try {
      const first = freshNodeId("delay");
      expect(first).toStartWith("delay-");
      expect(freshNodeId("delay")).not.toBe(first);
    } finally {
      globalThis.crypto = original;
    }
  });
});

describe("where a new node lands", () => {
  const audioInput = {
    device: { deviceId: "mic", label: "Desk mic" },
    id: "deviceIn:mic",
    kind: "node",
    name: "Desk mic",
    section: "sources",
    type: "deviceIn",
  } as const;
  const stationSlot = {
    id: "station",
    kind: "node",
    name: "Station",
    section: "sources",
    type: "station",
  } as const;
  const positionOf = (graph: NodeGraph, nodeId: string | null) =>
    graph.nodes.find((node) => node.id === nodeId)?.position;

  test("an Audio input stacks below the others, and a Station below it", () => {
    const start = patch(radio("a"));
    const first = addPaletteNode(start, audioInput);
    const second = addPaletteNode(first.graph, audioInput);
    const station = addPaletteNode(second.graph, stationSlot);

    const ys = [first, second, station].map(
      ({ graph, nodeId }) => positionOf(graph, nodeId)?.y
    );
    expect(ys).toEqual([
      STATION_ROW_HEIGHT,
      STATION_ROW_HEIGHT + 340,
      STATION_ROW_HEIGHT + 680,
    ]);
  });

  test("a File whose file is gone after a reload takes a file form's row", () => {
    forgetLocalFileUrls();
    const file = {
      data: {
        muted: false,
        radio: localFileRadio("file", {
          displayName: "Demo",
          duration: 10,
          fileName: "demo.mp3",
          fileSize: 100,
          mimeType: "audio/mpeg",
          objectUrl: "blob:https://radio.example/demo",
        }),
        volume: 1,
      },
      id: "file",
      position: { x: 0, y: STATION_ROW_HEIGHT },
      type: "file",
    } as const;
    const start = patch(radio("a"));
    const graph = { ...start, nodes: [...start.nodes, file] } as NodeGraph;

    expect(nextStationPosition(graph)).toEqual({
      x: 0,
      y: STATION_ROW_HEIGHT + 240,
    });
  });

  const gainEntry = {
    id: "gain",
    kind: "node",
    name: "Gain",
    section: "fx",
    type: "gain",
  } as const;

  test("an FX goes in its own column between the sources and Speakers, below everything", () => {
    const start = patch(radio("a"), radio("b"));
    const speakers = start.nodes.find((node) => node.type === "speakers");
    const { graph, nodeId } = addPaletteNode(start, gainEntry);

    const position = positionOf(graph, nodeId);
    expect(position).toEqual(nextFxPosition(start) ?? undefined);
    // Clear of the 240-wide source column, a short cable right of it.
    expect(position?.x).toBe(240 + 40);
    expect(position?.x).toBeLessThan(speakers?.position.x ?? 0);
    expect(position?.y).toBe(2 * STATION_ROW_HEIGHT);
  });

  test("an FX clears both source columns of a big patch", () => {
    const start = patch(
      ...Array.from({ length: 9 }, (_, index) => radio(String(index)))
    );
    const secondColumnX = Math.max(
      ...start.nodes
        .filter((node) => node.type === "station")
        .map((node) => node.position.x)
    );
    expect(secondColumnX).toBeGreaterThan(0);
    const { graph, nodeId } = addPaletteNode(start, gainEntry);

    expect(positionOf(graph, nodeId)?.x).toBe(secondColumnX + 240 + 40);
    expect(positionOf(graph, "speakers")?.x).toBeGreaterThanOrEqual(
      secondColumnX + 240 + 40 + WIDEST_FX + 40
    );
  });

  test("FX in a Blank patch share one column clear of Speakers, and a Station goes left of it", () => {
    const start = buildNodeGraphFromTemplate("blank");
    const first = addPaletteNode(start, gainEntry);
    const second = addPaletteNode(first.graph, gainEntry);

    const firstX = positionOf(first.graph, first.nodeId)?.x ?? 0;
    expect(positionOf(second.graph, second.nodeId)?.x).toBe(firstX);
    expect(positionOf(second.graph, "speakers")?.x).toBe(
      firstX + WIDEST_FX + 40
    );
    expect(nextStationPosition(second.graph).x).toBe(firstX - 40 - 240);
  });

  test("Speakers, and what is beside it, move right to make room for the FX column", () => {
    // The Starter's Speakers sit a cable's length from the slot.
    const start = buildNodeGraphFromTemplate("starter");
    const withOutput = addPaletteNode(start, {
      device: { deviceId: "usb", label: "USB" },
      id: "deviceOut:usb",
      kind: "node",
      name: "USB",
      section: "outputs",
      type: "deviceOut",
    });
    const fx = addPaletteNode(withOutput.graph, gainEntry);

    const fxX = positionOf(fx.graph, fx.nodeId)?.x ?? 0;
    const speakersX = positionOf(fx.graph, "speakers")?.x ?? 0;
    expect(fxX).toBe(240 + 40);
    expect(speakersX).toBe(fxX + WIDEST_FX + 40);
    // The Output device keeps to the Speakers column.
    expect(positionOf(fx.graph, withOutput.nodeId)?.x).toBe(speakersX);
    // The source stays; a Station added next lands below it, not the FX.
    expect(positionOf(fx.graph, STARTER_STATION_ID)).toEqual({ x: 0, y: 0 });
    expect(nextStationPosition(fx.graph)).toEqual({
      x: 0,
      y: STATION_ROW_HEIGHT,
    });
  });

  test("a four-knob FX added to a Starter clears Speakers by a gap", () => {
    const start = buildNodeGraphFromTemplate("starter");
    const { graph, nodeId } = addPaletteNode(start, {
      id: "cheapReverb",
      kind: "node",
      name: "Cheap Reverb",
      section: "fx",
      type: "cheapReverb",
    });

    const fxX = positionOf(graph, nodeId)?.x ?? 0;
    expect(positionOf(graph, "speakers")?.x).toBeGreaterThanOrEqual(
      fxX + WIDEST_FX + 40
    );
  });

  test("an Output device goes in the Speakers column, below the lowest output there", () => {
    const start = patch(radio("a"), radio("b"));
    const speakers = start.nodes.find((node) => node.type === "speakers");
    const entry = {
      device: { deviceId: "usb", label: "USB" },
      id: "deviceOut:usb",
      kind: "node",
      name: "USB",
      section: "outputs",
      type: "deviceOut",
    } as const;
    const first = addPaletteNode(start, entry);

    expect(positionOf(first.graph, first.nodeId)).toEqual({
      x: speakers?.position.x ?? 0,
      y: (speakers?.position.y ?? 0) + STATION_ROW_HEIGHT,
    });
    expect(nextOutputPosition(first.graph)).toEqual({
      x: speakers?.position.x ?? 0,
      y: (speakers?.position.y ?? 0) + 2 * STATION_ROW_HEIGHT,
    });
  });
});

describe("reconnectEdge", () => {
  test.each([
    ["parameter", "gate", undefined, 0.25],
    ["gate", "parameter", undefined, 1],
    ["parameter", "gate", -0.5, -0.5],
    ["gate", "parameter", -0.5, -0.5],
    ["parameter", "gate", 0, 0],
    ["gate", "parameter", 0, 0],
  ] as const)(
    "rewiring %s to %s preserves effective depth %s",
    (from, to, depth, expected) => {
      const base = modulationPatch();
      const targets = {
        gate: { target: "envelope", targetHandle: "in:control:gate" },
        parameter: { target: "filter", targetHandle: "in:control:parameter" },
      };
      const source = { source: "macro", sourceHandle: "out:control:main" };
      const wired = connectNodes(
        nodeGraphSchema.parse({
          ...base,
          edges: [],
          nodes: [
            ...base.nodes,
            { id: "envelope", position: { x: 0, y: 0 }, type: "envelope" },
          ],
        }),
        { ...source, ...targets[from] }
      );
      expect(wired.edges[0]?.depth).toBeUndefined();
      const start =
        depth === undefined
          ? wired
          : {
              ...wired,
              edges: wired.edges.map((edge) => ({ ...edge, depth })),
            };
      const next = accepted(
        reconnectEdge(start, start.edges[0]?.id ?? "", {
          ...source,
          ...targets[to],
        })
      );
      expect(next.edges[0]).toMatchObject({ depth: expected, ...targets[to] });
      expect(validate(next)).toEqual([]);
    }
  );

  test("rewiring an incompatible parameter persists the first unused target parameter", () => {
    const initial = modulationPatch();
    const start = nodeGraphSchema.parse({
      ...initial,
      edges: [
        { ...initial.edges[0], id: "cutoff", parameter: "frequency" },
        { ...initial.edges[0], parameter: "pan", target: "pan" },
      ],
    });
    const next = accepted(
      reconnectEdge(start, "control", {
        source: "macro",
        sourceHandle: "out:control:main",
        target: "filter",
        targetHandle: "in:control:parameter",
      })
    );
    expect(next.edges[1]).toMatchObject({
      depth: -0.5,
      id: "control",
      parameter: "Q",
      target: "filter",
    });
    expect(validate(next)).toEqual([]);
  });

  test("an explicit reconnect parameter updates even when the endpoints stay the same", () => {
    const start = modulationPatch();
    const next = accepted(
      reconnectEdge(start, "control", {
        parameter: "frequency",
        source: "macro",
        sourceHandle: "out:control:main",
        target: "filter",
        targetHandle: "in:control:parameter",
      })
    );
    expect(next.edges[0]).toMatchObject({
      depth: -0.5,
      parameter: "frequency",
    });
    expect(validate(next)).toEqual([]);
  });

  test("reconnecting to another parameter module clears incompatible metadata", () => {
    const start = modulationPatch();
    const next = accepted(
      reconnectEdge(start, "control", {
        source: "macro",
        sourceHandle: "out:control:main",
        target: "pan",
        targetHandle: "in:control:parameter",
      })
    );
    expect(next.edges[0]).toMatchObject({ depth: -0.5, target: "pan" });
    expect(next.edges[0]?.parameter).toBe("pan");
    expect(validate(next)).toEqual([]);
  });

  test("reconnecting a source keeps a compatible target and checks the final cable", () => {
    const start = modulationPatch();
    const next = accepted(
      reconnectEdge(start, "control", {
        source: "other-macro",
        sourceHandle: "out:control:main",
        target: "filter",
        targetHandle: "in:control:parameter",
      })
    );
    expect(next.edges[0]).toMatchObject({ depth: -0.5, parameter: "Q" });
    expect(validate(next)).toEqual([]);

    const occupied = nodeGraphSchema.parse({
      ...start,
      edges: [
        ...start.edges,
        { ...start.edges[0], id: "occupied", source: "other-macro" },
      ],
    });
    expect(
      reconnectEdge(occupied, "control", {
        source: "other-macro",
        sourceHandle: "out:control:main",
        target: "filter",
        targetHandle: "in:control:parameter",
      })
    ).toMatchObject({ message: "These are already connected", ok: false });
  });

  test("moves a cable end in one edit, keeping its identity and settings", () => {
    const start = patch(radio("a"), radio("b"));
    const [cable] = start.edges;
    const leveled = {
      ...start,
      edges: start.edges.map((edge) =>
        edge.id === cable?.id
          ? {
              ...edge,
              color: "#abc123",
              depth: 0.25,
              gain: 0.5,
              muted: true,
              transform: { max: 0.8, min: 0.2 },
            }
          : edge
      ),
    };
    const withGain = addPaletteNode(leveled, {
      id: "gain",
      kind: "node",
      name: "Gain",
      section: "fx",
      type: "gain",
    });
    const edit = reconnectEdge(withGain.graph, cable?.id ?? "", {
      id: "replacement-id",
      source: "src-a",
      sourceHandle: "out:audio:main",
      target: withGain.nodeId ?? "",
      targetHandle: "in:audio:main",
    });

    expect(edit.ok).toBe(true);
    if (!edit.ok) {
      return;
    }
    expect(edit.graph.edges.map((edge) => edge.id)).toEqual(
      withGain.graph.edges.map((edge) => edge.id)
    );
    expect(edit.graph.edges[0]).toMatchObject({
      color: "#abc123",
      gain: 0.5,
      id: cable?.id,
      muted: true,
      source: "src-a",
      target: withGain.nodeId,
      transform: { max: 0.8, min: 0.2 },
    });
    expect(edit.graph.edges[0]?.depth).toBeUndefined();
  });

  test("rewiring a branch preserves its compiled pan, solo and gain", () => {
    const start = inserted(
      inserted(patch(radio("a")), "compressor", "src-a->speakers").graph,
      "delay",
      "compressor->speakers"
    ).graph;
    const split = seriesToParallel(start, {
      edges: [],
      nodes: ["compressor", "delay"],
    });
    if (!split.ok) {
      throw new Error(split.message);
    }
    const branch = split.graph.edges.find(
      (edge) => edge.target === "compressor"
    );
    const merge = split.graph.nodes.find((node) => node.type === "merge");
    if (!(branch && merge)) {
      throw new Error("Expected a branch into a Merge");
    }
    const leveled = {
      ...split.graph,
      edges: split.graph.edges.map((edge) =>
        edge === branch ? { ...edge, gain: 0.5, pan: -0.75, solo: true } : edge
      ),
    };
    const edit = reconnectEdge(leveled, branch.id, {
      source: branch.source,
      sourceHandle: branch.sourceHandle,
      target: merge.id,
      targetHandle: "in:audio:main",
    });
    if (!edit.ok) {
      throw new Error(edit.message);
    }
    expect(edit.graph.edges.find((edge) => edge.id === branch.id)).toEqual({
      ...branch,
      gain: 0.5,
      pan: -0.75,
      solo: true,
      target: merge.id,
    });
    const before = compile(leveled, ENV);
    const after = compile(edit.graph, ENV);
    expect(before.issues).toEqual([]);
    expect(after.issues).toEqual([]);
    const branchSettings = (graph: NodeGraph) => {
      const [effect] = compile(graph, ENV).lanes.get("src-a")?.effects ?? [];
      if (effect?.type !== "fxComposite") {
        throw new Error("Expected a Split");
      }
      return effect.chains.map(({ gain, id, pan, solo }) => ({
        gain,
        id,
        pan,
        solo,
      }));
    };
    expect(branchSettings(edit.graph)).toEqual(branchSettings(leveled));
    expect(branchSettings(edit.graph)[0]).toMatchObject({
      pan: -0.75,
      solo: true,
    });
  });

  test("a branch cable moved off its split drops the pan and solo it can't show", () => {
    const start = inserted(
      inserted(patch(radio("a")), "compressor", "src-a->speakers").graph,
      "delay",
      "compressor->speakers"
    ).graph;
    const split = seriesToParallel(start, {
      edges: [],
      nodes: ["compressor", "delay"],
    });
    if (!split.ok) {
      throw new Error(split.message);
    }
    const branch = split.graph.edges.find(
      (edge) => edge.target === "compressor"
    );
    if (!branch) {
      throw new Error("Expected a branch");
    }
    const soloed = {
      ...split.graph,
      edges: split.graph.edges.map((edge) =>
        edge === branch ? { ...edge, gain: 0.5, pan: -0.75, solo: true } : edge
      ),
    };
    const edit = reconnectEdge(soloed, branch.id, {
      source: "src-a",
      sourceHandle: "out:audio:main",
      target: "compressor",
      targetHandle: "in:audio:main",
    });
    if (!edit.ok) {
      throw new Error(edit.message);
    }
    const moved = edit.graph.edges.find((edge) => edge.id === branch.id);
    expect(moved).toMatchObject({ gain: 0.5, source: "src-a" });
    expect(moved?.pan).toBeUndefined();
    expect(moved?.solo).toBeUndefined();
  });

  test("reconnects into an occupied input without replacing its other cable", () => {
    const start = patch(radio("a"), radio("b"));
    const withGain = addPaletteNode(start, {
      id: "gain",
      kind: "node",
      name: "Gain",
      section: "fx",
      type: "gain",
    });
    const gain = withGain.nodeId ?? "";
    const wired = connectNodes(withGain.graph, {
      source: "src-a",
      sourceHandle: "out:audio:main",
      target: gain,
      targetHandle: "in:audio:main",
    });
    const intoGain = wired.edges.at(-1)?.id ?? "";

    // Its own end, from Station A to Station B: the input it frees takes it.
    const moved = reconnectEdge(wired, intoGain, {
      source: "src-b",
      sourceHandle: "out:audio:main",
      target: gain,
      targetHandle: "in:audio:main",
    });
    expect(moved.ok).toBe(true);

    // Station B's cable to Speakers onto the Gain's input Station A holds:
    // the input sums both.
    const toSpeakers = wired.edges.find((edge) => edge.source === "src-b");
    const summed = reconnectEdge(wired, toSpeakers?.id ?? "", {
      source: "src-b",
      sourceHandle: "out:audio:main",
      target: gain,
      targetHandle: "in:audio:main",
    });
    expect(summed.ok).toBe(true);
    if (summed.ok) {
      expect(
        summed.graph.edges
          .filter((edge) => edge.target === gain)
          .map((edge) => edge.source)
          .sort()
      ).toEqual(["src-a", "src-b"]);
    }
  });

  test("the same ends are a no-op", () => {
    const start = patch(radio("a"));
    const [cable] = start.edges;
    const edit = reconnectEdge(start, cable?.id ?? "", {
      source: cable?.source ?? "",
      sourceHandle: cable?.sourceHandle,
      target: cable?.target ?? "",
      targetHandle: cable?.targetHandle,
    });
    expect(edit).toEqual({ graph: start, ok: true });
  });
});

describe("empty Station slots", () => {
  test("a slot dropped from Speakers is wired in and has no lane until filled", () => {
    const start = buildNodeGraphFromTemplate("blank");
    const added = addPaletteNode(
      start,
      {
        id: "station",
        kind: "node",
        name: "Station",
        section: "sources",
        type: "station",
      },
      {
        from: {
          handle: "in:audio:main",
          node: SPEAKERS_NODE_ID,
          type: "target",
        },
        position: { x: 10, y: 20 },
      }
    );
    const { graph } = added;
    const nodeId = added.nodeId ?? "";

    expect(graph.edges).toHaveLength(1);
    expect(compile(graph, ENV).lanes.size).toBe(0);

    const filled = setStationRadio(graph, nodeId, radio("a"));
    expect([...compile(filled, ENV).lanes.keys()]).toEqual([nodeId]);
    expect(findStationNode(filled, radio("a"))?.id).toBe(nodeId);
  });
});

describe("removeNodes and removeEdges", () => {
  test("removing a Station drops its cables", () => {
    const start = patch(radio("a"), radio("b"));
    const graph = removeNodes(start, ["src-a"]);

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "src-b",
      SPEAKERS_NODE_ID,
    ]);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["src-b->speakers"]);
    expect(removeNodes(graph, ["missing"])).toBe(graph);
  });

  test("the delete key removes the selection but keeps Speakers", () => {
    const start = patch(radio("a"), radio("b"), radio("c"));
    const graph = accepted(
      removeSelection(start, {
        edges: ["src-c->speakers"],
        nodes: ["src-a", SPEAKERS_NODE_ID],
      })
    );

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "src-b",
      "src-c",
      SPEAKERS_NODE_ID,
    ]);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["src-b->speakers"]);
    expect(
      accepted(removeSelection(start, { edges: [], nodes: [SPEAKERS_NODE_ID] }))
    ).toBe(start);
  });

  test("a removed cable can be connected again", () => {
    const start = patch(radio("a"));
    const cut = removeEdges(start, ["src-a->speakers"]);
    expect(cut.edges).toEqual([]);

    const joined = connectNodes(cut, {
      source: "src-a",
      sourceHandle: "out:audio:main",
      target: SPEAKERS_NODE_ID,
      targetHandle: "in:audio:main",
    });
    expect(joined.edges.map((edge) => edge.id)).toEqual(["src-a->speakers"]);
  });
});

test("moveNodes commits only changed positions", () => {
  const start = patch(radio("a"));
  expect(moveNodes(start, new Map([["src-a", { x: 0, y: 0 }]]))).toBe(start);

  const moved = moveNodes(start, new Map([["src-a", { x: 5, y: 6 }]]));
  expect(moved.nodes[0]?.position).toEqual({ x: 5, y: 6 });
});

test("setViewport commits only a changed viewport", () => {
  const start = patch(radio("a"));
  expect(setViewport(start, { ...start.viewport })).toBe(start);
  const panned = setViewport(start, { x: 40, y: -12, zoom: 0.75 });
  expect(panned.viewport).toEqual({ x: 40, y: -12, zoom: 0.75 });
  expect(panned.nodes).toBe(start.nodes);
});

describe("syncStationSnapshots", () => {
  test("follows an edit and a hide, and ignores key order", () => {
    const start = patch(radio("a"));
    const renamed = { ...radio("a"), name: "Renamed" };
    const synced = syncStationSnapshots(start, () => renamed);
    expect(findStationNode(synced, renamed)?.data.radio?.name).toBe("Renamed");

    const reordered = Object.fromEntries(
      Object.entries(renamed).reverse()
    ) as Radio;
    expect(syncStationSnapshots(synced, () => reordered)).toBe(synced);

    const hidden = syncStationSnapshots(synced, () => ({
      ...renamed,
      enabled: false,
    }));
    expect(hidden.nodes.map((node) => node.id)).toContain("src-a");
    expect(compile(hidden, ENV).lanes.size).toBe(0);
  });

  test("keeps the snapshot of a station whose record is gone", () => {
    const start = patch(radio("a"));
    expect(syncStationSnapshots(start, () => undefined)).toBe(start);
  });
});

describe("setEffectParams", () => {
  const { graph: withComp, nodeId } = addPaletteNode(patch(radio("a")), {
    id: "compressor",
    kind: "node",
    name: "Compressor",
    section: "fx",
    type: "compressor",
  });
  const compId = nodeId as string;

  test("merges a param into the effect and keeps its id", () => {
    const graph = setEffectParams(withComp, compId, {
      id: "other",
      threshold: -24,
    } as never);

    expect(graph.nodes.find((node) => node.id === compId)).toMatchObject({
      data: { effect: { id: compId, threshold: -24 } },
    });
  });

  test("returns the same graph when nothing changes or the node isn't FX", () => {
    expect(setEffectParams(withComp, compId, { enabled: true })).toBe(withComp);
    expect(setEffectParams(withComp, "src-a", { enabled: false })).toBe(
      withComp
    );
  });
});

describe("connectNodes: key cables", () => {
  const start = patch(radio("a"), radio("b"));
  const withFx = (type: "vocoder" | "compressor") =>
    withLoose(start, type).graph;
  const keyFrom = (target: string) => ({
    source: "src-b",
    sourceHandle: "out:audio:main",
    target,
    targetHandle: "in:sidechain:key",
  });
  const effectOf = (graph: ReturnType<typeof withFx>, id: string) =>
    graph.nodes.find((node) => node.id === id)?.data as {
      effect: Record<string, unknown>;
    };

  test("a key into a Vocoder preserves its authored modulator", () => {
    const vocoder = withFx("vocoder");
    expect(effectOf(vocoder, "vocoder").effect.modulatorSource).toBe(
      "noise-pink"
    );

    const keyed = connectNodes(vocoder, keyFrom("vocoder"));

    expect(keyed.nodes).toBe(vocoder.nodes);
    expect(effectOf(keyed, "vocoder").effect.modulatorSource).toBe(
      "noise-pink"
    );
    expect(keyed.edges.at(-1)).toMatchObject({
      source: "src-b",
      targetHandle: "in:sidechain:key",
    });
  });

  test("a key into a Compressor leaves its params alone", () => {
    const compressor = withFx("compressor");
    const keyed = connectNodes(compressor, keyFrom("compressor"));

    expect(keyed.nodes).toBe(compressor.nodes);
    expect(effectOf(keyed, "compressor").effect).not.toHaveProperty(
      "modulatorSource"
    );
  });
});

describe("setNativeParams", () => {
  const { graph: withPan, nodeId } = addPaletteNode(patch(radio("a")), {
    id: "pan",
    kind: "node",
    name: "Pan",
    section: "fx",
    type: "pan",
  });
  const panId = nodeId as string;

  test("sets only the fields the node has", () => {
    const graph = setNativeParams(withPan, panId, { frequency: 400, pan: -1 });

    expect(graph.nodes.find((node) => node.id === panId)?.data).toEqual({
      pan: -1,
    });
  });

  test("returns the same graph for a no-op", () => {
    expect(setNativeParams(withPan, panId, { pan: 0 })).toBe(withPan);
    expect(setNativeParams(withPan, panId, { frequency: 400 })).toBe(withPan);
  });
});

/** An authored fixture with a stable id for cable-edit assertions. */
function withLoose(graph: NodeGraph, type: NodeType) {
  const node = createPaletteNode(type, type, { x: 240, y: 0 });
  if (!node) {
    throw new Error(`Cannot create fixture ${type}`);
  }
  return {
    graph: { ...graph, nodes: [...graph.nodes, node] },
    nodeId: node.id,
  };
}

function inserted(graph: NodeGraph, type: NodeType, edgeId: string) {
  const loose = withLoose(graph, type);
  const edit = insertNodeOnEdge(loose.graph, loose.nodeId, edgeId);
  if (!edit.ok) {
    throw new Error(edit.message);
  }
  return { graph: edit.graph, nodeId: loose.nodeId };
}

function effectIn(graph: NodeGraph, id: string): Record<string, unknown> {
  const node = graph.nodes.find((entry) => entry.id === id);
  return (
    (node?.data as { effect?: Record<string, unknown> } | undefined)?.effect ??
    {}
  );
}

function cables(graph: NodeGraph) {
  return graph.edges.map(
    (edge) =>
      `${edge.id}: ${edge.source} ${edge.sourceHandle} -> ${edge.target} ${edge.targetHandle}`
  );
}

describe("insertNodeOnEdge", () => {
  test("inserting and removing a Slew retains the original parameter assignment", () => {
    const start = modulationPatch();
    const edited = accepted(insertNodeOnEdge(start, "slew", "control"));
    const upstream = edited.edges.find((edge) => edge.target === "slew");
    const downstream = edited.edges.find((edge) => edge.source === "slew");
    expect(upstream?.depth).toBeUndefined();
    expect(upstream?.parameter).toBeUndefined();
    expect(downstream).toMatchObject({
      depth: -0.5,
      parameter: "Q",
      target: "filter",
    });
    expect(validate(edited)).toEqual([]);
    const healed = accepted(removeNodesHealed(edited, ["slew"]));
    expect(healed.edges).toHaveLength(1);
    expect(healed.edges[0]).toMatchObject({
      depth: -0.5,
      parameter: "Q",
      source: "macro",
      target: "filter",
    });
    expect(validate(healed)).toEqual([]);
  });

  test("healing combines signed control depths, including the default parameter depth", () => {
    const start = accepted(
      insertNodeOnEdge(modulationPatch(), "slew", "control")
    );
    const scaled = {
      ...start,
      edges: start.edges.map((edge) => {
        if (edge.target === "slew") {
          return { ...edge, depth: -0.5 };
        }
        const { depth: _depth, ...defaultDepth } = edge;
        return defaultDepth;
      }),
    };
    const healed = accepted(removeNodesHealed(scaled, ["slew"]));
    expect(healed.edges[0]).toMatchObject({ depth: -0.125, parameter: "Q" });
    expect(validate(healed)).toEqual([]);
  });

  test("splits one cable into two, the first keeping its id and level", () => {
    const start = patch(radio("a"));
    const gained = {
      ...start,
      edges: start.edges.map((edge) => ({ ...edge, gain: 0.5 })),
    };
    const { graph } = inserted(gained, "compressor", "src-a->speakers");

    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({
      gain: 0.5,
      id: "src-a->speakers",
      source: "src-a",
      target: "compressor",
      targetHandle: "in:audio:main",
    });
    expect(graph.edges[1]).toMatchObject({
      gain: 1,
      id: "compressor->speakers",
      source: "compressor",
      sourceHandle: "out:audio:main",
      target: SPEAKERS_NODE_ID,
      targetHandle: "in:audio:main",
    });
    expect(validate(graph)).toEqual([]);
    const lane = compile(graph, ENV).lanes.get("src-a");
    expect(lane?.effects.map((effect) => effect.id)).toEqual(["compressor"]);
  });

  test("a branch cable stays the branch, with its settings", () => {
    const start = inserted(
      inserted(patch(radio("a")), "compressor", "src-a->speakers").graph,
      "delay",
      "compressor->speakers"
    ).graph;
    const split = seriesToParallel(start, {
      edges: [],
      nodes: ["compressor", "delay"],
    });
    if (!split.ok) {
      throw new Error(split.message);
    }
    const branch = split.graph.edges.find(
      (edge) => edge.target === "compressor"
    );
    const soloed = {
      ...split.graph,
      edges: split.graph.edges.map((edge) =>
        edge === branch ? { ...edge, pan: -0.5, solo: true } : edge
      ),
    };
    const { graph } = inserted(soloed, "crusher", branch?.id ?? "");

    expect(graph.edges.find((edge) => edge.id === branch?.id)).toMatchObject({
      pan: -0.5,
      solo: true,
      source: branch?.source,
      sourceHandle: branch?.sourceHandle,
      target: "crusher",
    });
    expect(compile(graph, ENV).issues).toEqual([]);
  });

  test("refuses a node with cables, a node with no input, and a bad spot", () => {
    const start = inserted(
      patch(radio("a"), radio("b")),
      "compressor",
      "src-a->speakers"
    ).graph;

    const wired = insertNodeOnEdge(start, "compressor", "src-b->speakers");
    expect(wired).toEqual({
      message: "Only a node with no cables goes into a cable",
      ok: false,
    });

    const slot = withLoose(start, "station");
    expect(
      insertNodeOnEdge(slot.graph, slot.nodeId, "src-b->speakers").ok
    ).toBe(false);

    // A Filter after an FX runs as its own module.
    const filter = withLoose(start, "filter");
    const late = insertNodeOnEdge(
      filter.graph,
      filter.nodeId,
      "compressor->speakers"
    );
    expect(late.ok).toBe(true);
    // The station's cable into the Compressor keeps its old id.
    expect(
      insertNodeOnEdge(filter.graph, filter.nodeId, "src-a->speakers").ok
    ).toBe(true);
    expect(
      insertNodeOnEdge(filter.graph, filter.nodeId, "src-b->speakers").ok
    ).toBe(true);
  });
});

describe("removeNodesHealed", () => {
  test("deleting A -> X -> B heals into A -> B with the cable in's id", () => {
    const start = patch(radio("a"));
    const { graph } = inserted(start, "compressor", "src-a->speakers");
    const muted = {
      ...graph,
      edges: graph.edges.map((edge) =>
        edge.source === "compressor" ? { ...edge, gain: 2, muted: true } : edge
      ),
    };

    const healed = accepted(removeNodesHealed(muted, ["compressor"]));

    expect(healed.nodes.map((node) => node.id)).toEqual([
      "src-a",
      SPEAKERS_NODE_ID,
    ]);
    expect(healed.edges).toEqual([
      { ...start.edges[0], gain: 2, muted: true } as NodeGraph["edges"][number],
    ]);
    expect(validate(healed)).toEqual([]);
  });

  test("heals through a chain deleted together", () => {
    const one = inserted(patch(radio("a")), "compressor", "src-a->speakers");
    const two = inserted(one.graph, "delay", "compressor->speakers");

    const healed = accepted(
      removeSelection(two.graph, {
        edges: [],
        nodes: ["compressor", "delay"],
      })
    );

    expect(cables(healed)).toEqual([
      "src-a->speakers: src-a out:audio:main -> speakers in:audio:main",
    ]);
  });

  test("does not heal a key into audio", () => {
    const start = removeEdges(patch(radio("a"), radio("b")), [
      "src-b->speakers",
    ]);
    const { graph } = inserted(start, "compressor", "src-a->speakers");
    const keyed = connectNodes(graph, {
      source: "src-b",
      sourceHandle: "out:audio:main",
      target: "compressor",
      targetHandle: "in:sidechain:key",
    });
    expect(validate(keyed)).toEqual([]);

    const healed = accepted(removeNodesHealed(keyed, ["compressor"]));

    expect(cables(healed)).toEqual([
      "src-a->speakers: src-a out:audio:main -> speakers in:audio:main",
    ]);
  });

  test("a cable deleted with the node is not healed through", () => {
    const { graph } = inserted(
      patch(radio("a")),
      "compressor",
      "src-a->speakers"
    );
    const healed = accepted(
      removeSelection(graph, {
        edges: ["compressor->speakers"],
        nodes: ["compressor"],
      })
    );
    expect(healed.edges).toEqual([]);
  });

  test("deleting a Merge heals its branches to Speakers, where they meet again", () => {
    const one = inserted(patch(radio("a")), "compressor", "src-a->speakers");
    const two = inserted(one.graph, "delay", "compressor->speakers");
    const split = seriesToParallel(two.graph, {
      edges: [],
      nodes: ["compressor", "delay"],
    });
    if (!split.ok) {
      throw new Error(split.message);
    }
    const merge = split.graph.nodes.find((node) => node.type === "merge");

    const before = compile(split.graph, ENV);
    expect(before.lanes.size).toBe(1);
    expect(before.cables.size).toBe(1);
    expect(before.issues).toEqual([]);

    // Branches straight into Speakers meet again there, still one region.
    const healed = accepted(removeNodesHealed(split.graph, [merge?.id ?? ""]));
    const after = compile(healed, ENV);
    expect(after.issues).toEqual([]);
    expect(after.units.size + after.modules.size).toBe(0);
    expect(after.cables.size).toBe(1);

    const store = createNodeStore(split.graph);
    const { state } = store;
    commitNodeGraph(
      (current) => {
        const deletion = removeNodesHealed(current, [merge?.id ?? ""]);
        return deletion.ok ? deletion.graph : current;
      },
      store,
      "snapshot"
    );
    expect(store.state).not.toBe(state);
    expect(undoNodeGraph(store)).toBe(true);
    expect(store.state.graph).toEqual(split.graph);

    // Explicitly deleting the branch's source makes the disconnection deliberate.
    const deleted = accepted(
      removeSelection(split.graph, {
        edges: [],
        nodes: [merge?.id ?? "", "src-a"],
      })
    );
    expect(deleted.nodes.some((node) => node.id === "src-a")).toBe(false);
    expect(deleted.nodes.some((node) => node.type === "merge")).toBe(false);

    const wholeBranch = accepted(
      removeSelection(split.graph, {
        edges: [],
        nodes: split.graph.nodes
          .filter((node) => node.type !== "station" && node.type !== "speakers")
          .map((node) => node.id),
      })
    );
    expect(wholeBranch.nodes.map((node) => node.id)).toEqual([
      "src-a",
      "speakers",
    ]);
    expect(compile(wholeBranch, ENV).cables.size).toBe(1);
  });

  test("deleting a Merge keeps a hidden Station's route for when it shows again", () => {
    const one = inserted(patch(radio("a")), "compressor", "src-a->speakers");
    const two = inserted(one.graph, "delay", `${one.nodeId}->speakers`);
    const split = seriesToParallel(two.graph, {
      edges: [],
      nodes: [one.nodeId, two.nodeId],
    });
    if (!split.ok) {
      throw new Error(split.message);
    }
    const merge = split.graph.nodes.find((node) => node.type === "merge");
    const hidden = setStationsEnabled(split.graph, ["src-a"], false);
    expect(compile(hidden, ENV).cables.size).toBe(0);

    const edit = accepted(removeNodesHealed(hidden, [merge?.id ?? ""]));

    const shown = setStationsEnabled(edit, ["src-a"], true);
    expect(compile(shown, ENV).cables.size).toBe(1);
  });

  test("deleting a Merge keeps an empty Audio input's route for when it's set", () => {
    const one = inserted(patch(radio("a")), "compressor", "src-a->speakers");
    const two = inserted(one.graph, "delay", `${one.nodeId}->speakers`);
    const split = seriesToParallel(two.graph, {
      edges: [],
      nodes: [one.nodeId, two.nodeId],
    });
    if (!split.ok) {
      throw new Error(split.message);
    }
    const input = createPaletteNode("deviceIn", "src-a", { x: 0, y: 0 });
    expect(input?.data).toMatchObject({ deviceId: null });
    const empty = {
      ...split.graph,
      nodes: split.graph.nodes.map((node) =>
        node.id === "src-a" && input ? input : node
      ),
    };
    expect(compile(empty, ENV).cables.size).toBe(0);
    const merge = empty.nodes.find((node) => node.type === "merge");

    const healed = accepted(removeNodesHealed(empty, [merge?.id ?? ""]));
    // Once it has a device, the healed patch plays through the region.
    const live = setDeviceParams(healed, "src-a", { deviceId: "mic" });
    expect(compile(live, ENV).cables.size).toBe(1);
  });

  test("deleting a split turns a branch solo into mutes, never a hidden solo", () => {
    const one = inserted(patch(radio("a")), "compressor", "src-a->speakers");
    const two = inserted(one.graph, "delay", "compressor->speakers");
    const split = seriesToParallel(two.graph, {
      edges: [],
      nodes: ["compressor", "delay"],
    });
    if (!split.ok) {
      throw new Error(split.message);
    }
    const splitNode = split.graph.nodes.find(
      (node) => node.type === "fxComposite"
    );
    const soloed = {
      ...split.graph,
      edges: split.graph.edges.map((edge) =>
        edge.source === splitNode?.id && edge.target === "compressor"
          ? { ...edge, solo: true }
          : edge
      ),
    };

    const healed = accepted(removeNodesHealed(soloed, [splitNode?.id ?? ""]));

    // A Station's cables draw no branch controls, so they carry none.
    expect(
      healed.edges.filter(
        (edge) =>
          !isSplitNode(healed.nodes.find((node) => node.id === edge.source)) &&
          (edge.pan !== undefined || edge.solo !== undefined)
      )
    ).toEqual([]);
    const into = (target: string) =>
      healed.edges.find(
        (edge) => edge.source === "src-a" && edge.target === target
      );
    expect(into("compressor")?.muted).toBe(false);
    // The solo's sound stays: the branch it silenced is muted instead.
    expect(into("delay")?.muted).toBe(true);
    const plan = compile(healed, ENV);
    expect(plan.issues).toEqual([]);
    const [fanOut] = plan.lanes.get("src-a")?.effects ?? [];
    expect(
      fanOut && "chains" in fanOut
        ? fanOut.chains.map(({ muted, solo }) => ({ muted, solo }))
        : null
    ).toEqual([
      { muted: false, solo: false },
      { muted: true, solo: false },
    ]);
  });

  test("refuses to delete a split whose branch pan a plain cable would drop", () => {
    const one = inserted(patch(radio("a")), "compressor", "src-a->speakers");
    const two = inserted(one.graph, "delay", "compressor->speakers");
    const split = seriesToParallel(two.graph, {
      edges: [],
      nodes: ["compressor", "delay"],
    });
    if (!split.ok) {
      throw new Error(split.message);
    }
    const splitId =
      split.graph.nodes.find((node) => node.type === "fxComposite")?.id ?? "";
    const withCablePan = (pan: number) => ({
      ...split.graph,
      edges: split.graph.edges.map((edge) =>
        edge.source === splitId && edge.target === "compressor"
          ? { ...edge, pan }
          : edge
      ),
    });
    // A pan learned onto the Split's own chain, as MIDI sets it.
    const withChainPan = (graph: NodeGraph, pan: number) => ({
      ...graph,
      nodes: graph.nodes.map((node) => {
        if (node.id !== splitId || !("effect" in node.data)) {
          return node;
        }
        const effect = node.data.effect as {
          chains: { order: number; pan?: number }[];
        };
        return {
          ...node,
          data: {
            ...node.data,
            effect: {
              ...effect,
              chains: effect.chains.map((chain) =>
                chain.order === 0 ? { ...chain, pan } : chain
              ),
            },
          },
        } as typeof node;
      }),
    });
    const refusal = {
      message:
        "That Split can't be removed without changing the mix: a branch is panned, and a plain cable can't pan. Centre it first.",
      ok: false as const,
    };

    expect(removeNodesHealed(withCablePan(-0.5), [splitId])).toEqual(refusal);
    expect(
      removeNodesHealed(withChainPan(split.graph, 0.75), [splitId])
    ).toEqual(refusal);
    // A centred branch, or pans that cancel out, heals as before.
    for (const centred of [
      withCablePan(0),
      withChainPan(withCablePan(0.5), -0.5),
    ]) {
      const healed = accepted(removeNodesHealed(centred, [splitId]));
      expect(
        healed.edges.filter((edge) => edge.source === "src-a").length
      ).toBe(2);
      expect(healed.edges.some((edge) => edge.pan !== undefined)).toBe(false);
    }
    // With the station going too, there is no path left to re-centre.
    expect(removeNodesHealed(withCablePan(-0.5), [splitId, "src-a"]).ok).toBe(
      true
    );
  });

  test("deleting a nested split hands its pan to the outer split's cables", () => {
    const effect = (id: string, type: EffectNodeType) => ({
      data: { effect: createNodeEffectConfig(type, id) },
      id,
      position: { x: 0, y: 0 },
      type,
    });
    const cable = (
      source: string,
      target: string,
      from = "main",
      extra: Partial<NodeGraph["edges"][number]> = {}
    ) => ({
      id: `${source}->${target}:${from}`,
      source,
      sourceHandle: `out:audio:${from}`,
      target,
      targetHandle: "in:audio:main",
      ...extra,
    });
    const start = patch(radio("a"));
    const nested = nodeGraphSchema.parse({
      ...start,
      edges: [
        cable("src-a", "outer"),
        cable("outer", "inner", "branch-1", { pan: -0.5, solo: true }),
        cable("outer", "merge-outer", "branch-2"),
        cable("inner", "delay", "branch-1", { pan: 0.25 }),
        cable("inner", "crush", "branch-2", { solo: true }),
        cable("delay", "merge-outer"),
        cable("crush", "merge-outer"),
        cable("merge-outer", SPEAKERS_NODE_ID),
      ],
      nodes: [
        ...start.nodes,
        effect("outer", "fxComposite"),
        effect("inner", "fxComposite"),
        effect("delay", "delay"),
        effect("crush", "crusher"),
        {
          data: {},
          id: "merge-outer",
          position: { x: 0, y: 0 },
          type: "merge",
        },
      ],
    });
    expect(compile(nested, ENV).issues).toEqual([]);

    const healed = accepted(removeNodesHealed(nested, ["inner"]));

    const into = (target: string) =>
      healed.edges.find((edge) => edge.target === target);
    // The outer branch's own pan and solo stay; the inner split's pan adds
    // on, and its solo mutes the branch it silenced.
    expect(into("delay")).toMatchObject({
      muted: true,
      pan: -0.25,
      solo: true,
      source: "outer",
    });
    expect(into("crush")).toMatchObject({
      muted: false,
      pan: -0.5,
      solo: true,
      source: "outer",
    });
    expect(compile(healed, ENV).issues).toEqual([]);
  });

  test("deleting a split keeps each branch's chain level and mute", () => {
    const one = inserted(patch(radio("a")), "compressor", "src-a->speakers");
    const two = inserted(one.graph, "delay", "compressor->speakers");
    const split = seriesToParallel(two.graph, {
      edges: [],
      nodes: ["compressor", "delay"],
    });
    if (!split.ok) {
      throw new Error(split.message);
    }
    const splitNode = split.graph.nodes.find(
      (node) => node.type === "fxComposite"
    );
    const chainGains = (graph: NodeGraph) => {
      const [effect] = compile(graph, ENV).lanes.get("src-a")?.effects ?? [];
      return effect && "chains" in effect
        ? effect.chains.map(({ gain, muted }) => ({ gain, muted }))
        : null;
    };
    expect(chainGains(split.graph)).toEqual([
      { gain: Math.SQRT1_2, muted: false },
      { gain: Math.SQRT1_2, muted: false },
    ]);

    const healed = accepted(
      removeNodesHealed(split.graph, [splitNode?.id ?? ""])
    );
    expect(compile(healed, ENV).issues).toEqual([]);
    expect(chainGains(healed)).toEqual(chainGains(split.graph));

    // A chain muted (or trimmed) in the Split's own config, as MIDI sets it.
    const configured = {
      ...split.graph,
      nodes: split.graph.nodes.map((node) => {
        if (node.id !== splitNode?.id || !("effect" in node.data)) {
          return node;
        }
        const effect = node.data.effect as {
          chains: { order: number; gain: number; muted: boolean }[];
        };
        return {
          ...node,
          data: {
            ...node.data,
            effect: {
              ...effect,
              chains: effect.chains.map((chain) =>
                chain.order === 0
                  ? { ...chain, muted: true }
                  : { ...chain, gain: 2 }
              ),
            },
          },
        } as typeof node;
      }),
    };
    const reheal = accepted(
      removeNodesHealed(configured, [splitNode?.id ?? ""])
    );
    const into = (target: string) =>
      reheal.edges.find(
        (edge) => edge.source === "src-a" && edge.target === target
      );
    expect(into("compressor")).toMatchObject({ muted: true });
    expect(into("delay")).toMatchObject({ gain: 2, muted: false });
  });

  test("refuses a heal louder than one cable can be, rather than turn it down", () => {
    const { graph } = inserted(
      patch(radio("a")),
      "compressor",
      "src-a->speakers"
    );
    const gained = (inGain: number, outGain: number) => ({
      ...graph,
      edges: graph.edges.map((edge) => ({
        ...edge,
        gain: edge.target === "compressor" ? inGain : outGain,
      })),
    });

    expect(removeNodesHealed(gained(4, 4), ["compressor"])).toEqual({
      message:
        "Those nodes can't be removed without changing a level: the cables around them add up past 4×. Turn one down first.",
      ok: false,
    });
    expect(
      accepted(removeNodesHealed(gained(2, 2), ["compressor"])).edges
    ).toEqual([expect.objectContaining({ gain: 4, target: SPEAKERS_NODE_ID })]);
    // With no cable out there is nothing to heal, so nothing to refuse.
    const dangling = removeEdges(gained(4, 4), ["compressor->speakers"]);
    expect(accepted(removeNodesHealed(dangling, ["compressor"])).edges).toEqual(
      []
    );
  });

  test("deleting a loose node or one with no output is allowed", () => {
    const loose = withLoose(patch(radio("a")), "compressor");
    const deleted = accepted(removeNodesHealed(loose.graph, [loose.nodeId]));
    expect(deleted.nodes.some((node) => node.id === loose.nodeId)).toBe(false);
    expect(compile(deleted, ENV).cables.size).toBe(1);

    const insertedNode = inserted(
      patch(radio("a")),
      "delay",
      "src-a->speakers"
    );
    const dangling = removeEdges(insertedNode.graph, ["delay->speakers"]);
    expect(accepted(removeNodesHealed(dangling, ["delay"])).edges).toEqual([]);
  });
});

describe("swapEffect", () => {
  const start = inserted(
    patch(radio("a"), radio("b")),
    "compressor",
    "src-a->speakers"
  ).graph;

  test("keeps the node id, every cable's id and handles, and the mix", () => {
    const tuned = setEffectParams(start, "compressor", {
      dryWet: 0.4,
      enabled: false,
      threshold: -30,
    } as never);

    const swapped = swapEffect(tuned, "compressor", "delay");

    expect(swapped.edges).toBe(tuned.edges);
    const node = swapped.nodes.find((entry) => entry.id === "compressor");
    expect(node?.type).toBe("delay");
    expect(effectIn(swapped, "compressor")).toMatchObject({
      dryWet: 0.4,
      enabled: false,
      id: "compressor",
      type: "delay",
    });
    expect(effectIn(swapped, "compressor")).not.toHaveProperty("threshold");
    expect(validate(swapped)).toEqual([]);
    const lane = compile(swapped, ENV).lanes.get("src-a");
    expect(lane?.effects.map((effect) => effect.type)).toEqual(["delay"]);
  });

  test("drops a key the new effect has no port for, and keeps it where it has", () => {
    const keyed = connectNodes(removeEdges(start, ["src-b->speakers"]), {
      source: "src-b",
      sourceHandle: "out:audio:main",
      target: "compressor",
      targetHandle: "in:sidechain:key",
    });

    const vocoder = swapEffect(keyed, "compressor", "vocoder");
    expect(vocoder.edges).toBe(keyed.edges);
    expect(effectIn(vocoder, "compressor").modulatorSource).toBe("external");

    const delay = swapEffect(keyed, "compressor", "delay");
    expect(cables(delay)).toEqual(
      cables(keyed).filter((cable) => !cable.includes("sidechain"))
    );
  });

  test("returns the same graph for the same type, a split or a Station", () => {
    expect(swapEffect(start, "compressor", "compressor")).toBe(start);
    expect(swapEffect(start, "compressor", "fxComposite")).toBe(start);
    expect(swapEffect(start, "src-a", "delay")).toBe(start);
  });
});

describe("toggleBypass", () => {
  const start = inserted(
    patch(radio("a")),
    "compressor",
    "src-a->speakers"
  ).graph;

  test("B toggles the first FX and rebuilds its pre-mix signal gain", () => {
    const bypassed = toggleBypass(start, ["compressor", "src-a"]);

    expect(effectIn(bypassed, "compressor").enabled).toBe(false);
    const ops = diff(compile(start, ENV), compile(bypassed, ENV));
    expect(ops.map((op) => op.type)).toEqual(["replaceLaneEffects"]);

    const back = toggleBypass(bypassed, ["compressor"]);
    expect(effectIn(back, "compressor").enabled).toBe(true);
    expect(
      diff(compile(bypassed, ENV), compile(back, ENV)).map((op) => op.type)
    ).toEqual(["replaceLaneEffects"]);
  });

  test("a mixed selection bypasses all; nothing to bypass is a no-op", () => {
    const two = inserted(start, "delay", "compressor->speakers").graph;
    const mixed = toggleBypass(two, ["delay"]);
    const all = toggleBypass(mixed, ["compressor", "delay"]);
    expect(effectIn(all, "compressor").enabled).toBe(false);
    expect(effectIn(all, "delay").enabled).toBe(false);

    expect(toggleBypass(start, ["src-a", SPEAKERS_NODE_ID])).toBe(start);
  });
});

describe("setDeviceParams", () => {
  const withDevices = () =>
    withLoose(withLoose(patch(radio("a")), "deviceIn").graph, "deviceOut")
      .graph;

  test("sets an Audio input's device and channels, and an Output device's device", () => {
    let graph = setDeviceParams(withDevices(), "deviceIn", {
      channelSelection: { left: 1, right: 1 },
      deviceId: "mic",
      deviceLabel: "Desk mic",
    });
    graph = setDeviceParams(graph, "deviceOut", {
      // An Output device has no channels: ignored.
      channelSelection: { left: 0, right: 0 },
      deviceId: "usb",
      deviceLabel: "USB interface",
    });

    expect(graph.nodes.find((node) => node.id === "deviceIn")?.data).toEqual({
      channelSelection: { left: 1, right: 1 },
      deviceId: "mic",
      deviceLabel: "Desk mic",
      echoCancellation: false,
      muted: false,
      strip: DEFAULT_INPUT_STRIP,
      volume: 1,
    });
    expect(graph.nodes.find((node) => node.id === "deviceOut")?.data).toEqual({
      deviceId: "usb",
      deviceLabel: "USB interface",
      muted: false,
    });
  });

  test("a copied Output device keeps its device and independent mute", () => {
    const start = setDeviceParams(withDevices(), "deviceOut", {
      deviceId: "usb",
      deviceLabel: "USB interface",
    });

    const { graph, nodeIds } = duplicateNodes(start, ["deviceOut"]);

    expect(
      graph.nodes.find((node) => node.id === nodeIds[0])?.data
    ).toMatchObject({ deviceId: "usb", deviceLabel: "USB interface" });
    const mutedCopy = setDeviceParams(graph, nodeIds[0] ?? "", { muted: true });
    expect(
      mutedCopy.nodes.find((node) => node.id === nodeIds[0])?.data
    ).toMatchObject({ deviceId: "usb", muted: true });
    expect(
      mutedCopy.nodes.find((node) => node.id === "deviceOut")?.data
    ).toMatchObject({ deviceId: "usb", muted: false });
    expect(validate(graph)).toEqual([]);
    expect(validate(mutedCopy)).toEqual([]);
  });
});

describe("duplicateNodes", () => {
  test("copies get new ids, offsets, and the cables between them", () => {
    const start = inserted(
      patch(radio("a")),
      "compressor",
      "src-a->speakers"
    ).graph;

    const { graph, nodeIds } = duplicateNodes(start, [
      "src-a",
      "compressor",
      SPEAKERS_NODE_ID,
    ]);

    const [stationCopy, copyId = ""] = nodeIds;
    expect(stationCopy).toBe("src-a-2");
    expect(copyId).toStartWith("compressor-");
    expect(graph.nodes.slice(0, start.nodes.length)).toEqual(start.nodes);
    const copy = graph.nodes.find((node) => node.id === copyId);
    const original = start.nodes.find((node) => node.id === "compressor");
    expect(copy?.position).toEqual({
      x: (original?.position.x ?? 0) + DUPLICATE_OFFSET_PX,
      y: (original?.position.y ?? 0) + DUPLICATE_OFFSET_PX,
    });
    expect(effectIn(graph, copyId).id).toBe(copyId);
    expect(cables(graph).slice(start.edges.length)).toEqual([
      `src-a-2->${copyId}: src-a-2 out:audio:main -> ${copyId} in:audio:main`,
      `${copyId}->speakers: ${copyId} out:audio:main -> speakers in:audio:main`,
    ]);
    expect(validate(graph)).toEqual([]);
    expect([...compile(graph, ENV).lanes.keys()]).toEqual(["src-a", "src-a-2"]);
  });

  test("a copied Station keeps its cables out, an occupied input included", () => {
    const start = inserted(
      patch(radio("a")),
      "compressor",
      "src-a->speakers"
    ).graph;

    const station = duplicateNodes(patch(radio("a")), ["src-a"]);
    expect(cables(station.graph).at(-1)).toBe(
      "src-a-2->speakers: src-a-2 out:audio:main -> speakers in:audio:main"
    );

    // The Compressor's input sums the copy with the original.
    const feeding = duplicateNodes(start, ["src-a"]);
    expect(feeding.graph.edges).toHaveLength(start.edges.length + 1);
    expect(feeding.nodeIds).toEqual(["src-a-2"]);
    expect(validate(feeding.graph)).toEqual([]);

    expect(duplicateNodes(start, [SPEAKERS_NODE_ID])).toEqual({
      graph: start,
      nodeIds: [],
    });
  });

  test("a lone FX copy comes loose, so it can go into a cable", () => {
    const start = inserted(
      patch(radio("a"), radio("b")),
      "compressor",
      "src-a->speakers"
    ).graph;

    const { graph, nodeIds } = duplicateNodes(start, ["compressor"]);

    const [copyId = ""] = nodeIds;
    expect(nodeIds).toHaveLength(1);
    expect(graph.edges).toEqual(start.edges);
    const edit = insertNodeOnEdge(graph, copyId, "src-b->speakers");
    expect(edit.ok).toBe(true);
  });

  test("refuses copies past a patch budget instead of leaving them silent", () => {
    const full = patch(
      ...Array.from({ length: 24 }, (_, index) => radio(String(index)))
    );
    expect(validate(full)).toEqual([]);

    expect(duplicateNodes(full, ["src-0"])).toEqual({
      graph: full,
      message: "Up to 24 sources per patch",
      nodeIds: [],
    });

    // 2 cables plus 62 fillers into Speakers; the copied A -> FX cable is 65th.
    const start = inserted(
      patch(radio("a")),
      "compressor",
      "src-a->speakers"
    ).graph;
    const cabled = {
      ...start,
      edges: [
        ...start.edges,
        ...Array.from({ length: 62 }, (_, index) => ({
          gain: 1,
          id: `filler-${index}`,
          muted: false,
          source: "src-a",
          sourceHandle: "out:audio:main",
          target: SPEAKERS_NODE_ID,
          targetHandle: "in:audio:main",
        })),
      ],
    };
    const copied = duplicateNodes(cabled, ["src-a", "compressor"]);
    expect(copied).toMatchObject({
      graph: cabled,
      message: "Up to 64 cables per patch",
      nodeIds: [],
    });
  });

  test("a copy never takes a deleted copy's id, so its MIDI stays dormant", () => {
    const start = inserted(
      patch(radio("a")),
      "compressor",
      "src-a->speakers"
    ).graph;
    const first = duplicateNodes(start, ["compressor"]);
    const deleted = removeNodes(first.graph, first.nodeIds);
    expect(deleted.nodes).toEqual(start.nodes);

    const second = duplicateNodes(deleted, ["compressor"]);

    expect(second.nodeIds).toHaveLength(1);
    expect(second.nodeIds).not.toEqual(first.nodeIds);
  });

  test("a copy fed only through its key is not wired on", () => {
    const start = removeEdges(patch(radio("a"), radio("b")), [
      "src-b->speakers",
    ]);
    const { graph, nodeId } = inserted(start, "compressor", "src-a->speakers");
    const keyed = connectNodes(graph, {
      source: "src-b",
      sourceHandle: "out:audio:main",
      target: nodeId,
      targetHandle: "in:sidechain:key",
    });

    const copied = duplicateNodes(keyed, ["src-b", nodeId]);

    const copy = copied.nodeIds[1] ?? "";
    expect(copied.graph.edges.some((edge) => edge.source === copy)).toBe(false);
  });

  test("a copied split scopes its chains under its own id", () => {
    const start = inserted(
      inserted(patch(radio("a")), "compressor", "src-a->speakers").graph,
      "delay",
      "compressor->speakers"
    ).graph;
    const split = seriesToParallel(start, {
      edges: [],
      nodes: ["compressor", "delay"],
    });
    if (!split.ok) {
      throw new Error(split.message);
    }
    const original = split.graph.nodes.find(
      (node) => node.type === "fxComposite"
    );

    const { graph, nodeIds } = duplicateNodes(split.graph, [
      original?.id ?? "",
    ]);

    const [copyId] = nodeIds;
    const chains = (effect: Record<string, unknown>) =>
      (effect.chains as { id: string }[]).map((chain) => chain.id);
    const originalChains = chains(effectIn(graph, original?.id ?? ""));
    expect(
      originalChains.every((id) => id.startsWith(`${original?.id}:`))
    ).toBe(true);
    expect(chains(effectIn(graph, copyId ?? ""))).toEqual(
      originalChains.map(
        (id) => `${copyId}${id.slice((original?.id ?? "").length)}`
      )
    );
  });
});

describe("cable surgery undo", () => {
  const start = inserted(
    patch(radio("a"), radio("b")),
    "compressor",
    "src-a->speakers"
  ).graph;
  const loose = withLoose(start, "delay");
  const edits: [string, NodeGraph, (graph: NodeGraph) => NodeGraph][] = [
    [
      "insert",
      loose.graph,
      (graph) => {
        const edit = insertNodeOnEdge(graph, loose.nodeId, "src-b->speakers");
        return edit.ok ? edit.graph : graph;
      },
    ],
    [
      "heal",
      start,
      (graph) =>
        accepted(removeSelection(graph, { edges: [], nodes: ["compressor"] })),
    ],
    [
      "swap",
      start,
      (graph) => swapEffect(graph, "compressor", "delay" as EffectNodeType),
    ],
    ["bypass", start, (graph) => toggleBypass(graph, ["compressor"])],
    [
      "duplicate",
      start,
      (graph) => duplicateNodes(graph, ["src-a", "compressor"]).graph,
    ],
  ];

  for (const [name, before, edit] of edits) {
    test(`one undo takes back the ${name}`, () => {
      const store = createNodeStore(before);
      commitNodeGraph(edit, store, "snapshot");
      expect(store.state.graph).not.toBe(before);

      expect(undoNodeGraph(store)).toBe(true);
      expect(store.state.graph).toBe(before);
    });
  }
});
