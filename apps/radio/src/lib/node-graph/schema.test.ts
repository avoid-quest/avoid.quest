import { describe, expect, test } from "bun:test";
import { createNodeEffectConfig } from "./catalogue";
import { migrateNodeGraph, NODE_GRAPH_VERSION } from "./schema";

const position = { x: 0, y: 0 };

function multipleLayout(version: number = NODE_GRAPH_VERSION) {
  return {
    edges: [
      {
        id: "kexp->speakers",
        source: "src-kexp",
        sourceHandle: "out:audio:main",
        target: "speakers",
        targetHandle: "in:audio:main",
      },
      {
        gain: 0.5,
        id: "comp->speakers",
        source: "comp",
        sourceHandle: "out:audio:main",
        target: "speakers",
        targetHandle: "in:audio:main",
      },
    ],
    nodes: [
      {
        data: {
          radio: {
            id: "kexp",
            logoUrl: "https://example.com/kexp.png",
            name: "KEXP",
            streamUrl: "https://example.com/kexp.mp3",
          },
          volume: 0.8,
        },
        id: "src-kexp",
        position,
        type: "station",
      },
      { data: { radio: null }, id: "src-empty", position, type: "station" },
      {
        data: { effect: createNodeEffectConfig("compressor", "old-id") },
        id: "comp",
        position,
        type: "compressor",
      },
      { id: "speakers", position: { x: 480, y: 0 }, type: "speakers" },
    ],
    version,
  };
}

describe("migrateNodeGraph", () => {
  test("accepts a v1 graph and fills defaults", () => {
    const result = migrateNodeGraph(multipleLayout());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    const { graph } = result;
    expect(graph.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(graph.edges[0]).toMatchObject({ gain: 1, muted: false });
    expect(graph.edges[1]?.gain).toBe(0.5);

    const [kexp, empty, comp, speakers] = graph.nodes;
    expect(kexp?.type === "station" && kexp.data).toEqual({
      muted: false,
      radio: {
        id: "kexp",
        logoUrl: "https://example.com/kexp.png",
        name: "KEXP",
        streamUrl: "https://example.com/kexp.mp3",
      },
      volume: 0.8,
    });
    expect(empty?.type === "station" && empty.data.radio).toBeNull();
    expect(speakers?.data).toEqual({ muted: false });
    // The node id is the EffectConfig id, whatever the stored id said.
    expect(comp?.type === "compressor" && comp.data.effect.id).toBe("comp");
  });

  test("keeps a pinned flag and the viewport", () => {
    const raw = multipleLayout();
    const result = migrateNodeGraph({
      ...raw,
      nodes: raw.nodes.map((node) => ({ ...node, pinned: true })),
      viewport: { x: 12, y: -4, zoom: 1.5 },
    });
    expect(result.status === "ok" && result.graph.viewport).toEqual({
      x: 12,
      y: -4,
      zoom: 1.5,
    });
    expect(
      result.status === "ok" && result.graph.nodes.every((node) => node.pinned)
    ).toBe(true);
  });

  test.each([
    ["a non-object", "patch"],
    ["null", null],
    ["a missing version", { edges: [], nodes: [] }],
    ["a string version", { ...multipleLayout(), version: "1" }],
    ["version 0", multipleLayout(0)],
    ["a fractional version", multipleLayout(1.5)],
  ])("rejects %s", (_label, raw) => {
    expect(migrateNodeGraph(raw).status).toBe("invalid");
  });

  test.each([
    [
      "an unknown node type",
      (raw: ReturnType<typeof multipleLayout>) => ({
        ...raw,
        nodes: [...raw.nodes, { id: "x", position, type: "theremin" }],
      }),
    ],
    [
      "a missing node list",
      (raw: ReturnType<typeof multipleLayout>) => ({
        ...raw,
        nodes: undefined,
      }),
    ],
    [
      "a duplicate node id",
      (raw: ReturnType<typeof multipleLayout>) => ({
        ...raw,
        nodes: [...raw.nodes, { id: "speakers", position, type: "speakers" }],
      }),
    ],
    [
      "a duplicate edge id",
      (raw: ReturnType<typeof multipleLayout>) => ({
        ...raw,
        edges: [...raw.edges, raw.edges[0]],
      }),
    ],
    [
      "a cable to a missing node",
      (raw: ReturnType<typeof multipleLayout>) => ({
        ...raw,
        edges: [
          ...raw.edges,
          {
            id: "ghost",
            source: "src-kexp",
            sourceHandle: "out:audio:main",
            target: "gone",
            targetHandle: "in:audio:main",
          },
        ],
      }),
    ],
    [
      "a station volume above 1",
      (raw: ReturnType<typeof multipleLayout>) => ({
        ...raw,
        nodes: [
          {
            data: { radio: null, volume: 2 },
            id: "loud",
            position,
            type: "station",
          },
        ],
      }),
    ],
    [
      "an effect that does not match its node type",
      (raw: ReturnType<typeof multipleLayout>) => ({
        ...raw,
        nodes: [
          {
            data: { effect: createNodeEffectConfig("delay", "comp") },
            id: "comp",
            position,
            type: "compressor",
          },
        ],
      }),
    ],
    [
      "a cable louder than +12 dB",
      (raw: ReturnType<typeof multipleLayout>) => ({
        ...raw,
        edges: [{ ...raw.edges[0], gain: 1000 }],
      }),
    ],
    [
      "a Loop feedback above 0.95",
      (raw: ReturnType<typeof multipleLayout>) => ({
        ...raw,
        nodes: [{ data: { feedback: 1 }, id: "loop", position, type: "loop" }],
      }),
    ],
  ])("rejects %s", (_label, corrupt) => {
    const result = migrateNodeGraph(corrupt(multipleLayout()));
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.error.length).toBeGreaterThan(
      0
    );
  });

  test("marks an unknown future version read-only", () => {
    const result = migrateNodeGraph(multipleLayout(NODE_GRAPH_VERSION + 1));
    expect(result.status).toBe("read-only");
    if (result.status !== "read-only") {
      return;
    }
    expect(result.version).toBe(NODE_GRAPH_VERSION + 1);
    // Still readable as today's shape, so it can be shown but never saved.
    expect(result.graph?.nodes.map((node) => node.id)).toEqual([
      "src-kexp",
      "src-empty",
      "comp",
      "speakers",
    ]);
  });

  test("keeps a future version read-only even when it no longer parses", () => {
    const result = migrateNodeGraph({
      nodes: "new shape",
      version: NODE_GRAPH_VERSION + 7,
    });
    expect(result).toEqual({
      graph: null,
      status: "read-only",
      version: NODE_GRAPH_VERSION + 7,
    });
  });
});
