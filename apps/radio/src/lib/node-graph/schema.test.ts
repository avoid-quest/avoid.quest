import { describe, expect, test } from "bun:test";
import { createNodeEffectConfig } from "./catalogue";
import {
  DEFAULT_INPUT_STRIP,
  DEFAULT_MEDIA_STRIP,
  DEFAULT_STATION_STRIP,
  migrateNodeGraph,
  NODE_GRAPH_VERSION,
  nodeGraphSchema,
  stripForType,
} from "./schema";

const position = { x: 0, y: 0 };

function migratedLayout(version: number = NODE_GRAPH_VERSION) {
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
  test.each([0, 2])("rejects a current patch with %i Speakers", (count) => {
    const raw = {
      edges: [],
      nodes: Array.from({ length: count }, (_, index) => ({
        id: `speakers-${index}`,
        position,
        type: "speakers",
      })),
      version: NODE_GRAPH_VERSION,
    };
    expect(nodeGraphSchema.safeParse(raw).success).toBe(false);
    const result = migrateNodeGraph(raw);
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.error).toContain(
      "A patch must have exactly one Speakers"
    );
  });

  test("accepts disconnected nodes beside a single Speakers", () => {
    const raw = { ...migratedLayout(), edges: [] };
    const result = migrateNodeGraph(raw);
    expect(nodeGraphSchema.safeParse(raw).success).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.graph.nodes).toHaveLength(4);
  });

  test("keeps a future patch without Speakers read-only and untouched", () => {
    const raw = {
      edges: [],
      nodes: [],
      version: NODE_GRAPH_VERSION + 1,
    };
    expect(migrateNodeGraph(raw)).toEqual({
      graph: null,
      status: "read-only",
      version: NODE_GRAPH_VERSION + 1,
    });
    expect(raw).toEqual({
      edges: [],
      nodes: [],
      version: NODE_GRAPH_VERSION + 1,
    });
  });

  test("accepts a v1 graph, upgrades it to v2 and fills defaults", () => {
    const result = migrateNodeGraph(migratedLayout(1));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    const { graph } = result;
    expect(graph.version).toBe(2);
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
      strip: DEFAULT_STATION_STRIP,
      volume: 0.8,
    });
    expect(empty?.type === "station" && empty.data.radio).toBeNull();
    expect(speakers?.data).toEqual({ muted: false });
    // The node id is the EffectConfig id, whatever the stored id said.
    expect(comp?.type === "compressor" && comp.data.effect.id).toBe("comp");
  });

  test("gives every v1 source its default strip", () => {
    const result = migrateNodeGraph({
      edges: [],
      nodes: [
        { data: { radio: null }, id: "station", position, type: "station" },
        { id: "track", position, type: "platform" },
        { data: { volume: 0.5 }, id: "file", position, type: "file" },
        { data: { deviceId: "mic" }, id: "input", position, type: "deviceIn" },
        { id: "speakers", position, type: "speakers" },
      ],
      version: 1,
    });
    expect(result.status === "ok" && result.graph.version).toBe(2);
    const strips = Object.fromEntries(
      (result.status === "ok" ? result.graph.nodes : []).map((node) => [
        node.id,
        "strip" in node.data ? node.data.strip : null,
      ])
    );
    expect(strips).toEqual({
      file: DEFAULT_MEDIA_STRIP,
      input: DEFAULT_INPUT_STRIP,
      speakers: null,
      station: DEFAULT_STATION_STRIP,
      track: DEFAULT_MEDIA_STRIP,
    });
  });

  test("keeps a v2 strip as stored", () => {
    const strip = {
      ...DEFAULT_MEDIA_STRIP,
      cue: 42.5,
      keyLock: false,
      loop: true,
      pan: -0.25,
      solo: true,
      speed: 1.25,
      trimDb: 6,
    };
    const result = migrateNodeGraph({
      edges: [],
      nodes: [
        { data: { radio: null, strip }, id: "file", position, type: "file" },
        { id: "speakers", position, type: "speakers" },
      ],
      version: 2,
    });
    expect(
      result.status === "ok" &&
        result.graph.nodes[0]?.type === "file" &&
        result.graph.nodes[0].data.strip
    ).toEqual(strip);
  });

  test("pulls a stored Filter's cutoff and Q into a safe range", () => {
    const filtered = (data: Record<string, unknown>) => {
      const result = migrateNodeGraph({
        edges: [],
        nodes: [
          { data, id: "filter", position, type: "filter" },
          { id: "speakers", position, type: "speakers" },
        ],
        version: NODE_GRAPH_VERSION,
      });
      const [filter] = result.status === "ok" ? result.graph.nodes : [];
      return filter?.type === "filter" ? filter.data : null;
    };

    // A +300 dB resonance would scream; the old Filter went up to Q 30.
    expect(filtered({ frequency: 1e6, Q: 300 })).toEqual({
      frequency: 20_000,
      Q: 30,
      type: "lowpass",
    });
    expect(filtered({ frequency: 1, Q: 0.01, type: "highpass" })).toEqual({
      frequency: 20,
      Q: 0.1,
      type: "highpass",
    });
    expect(filtered({ frequency: 440, Q: 25 })).toEqual({
      frequency: 440,
      Q: 25,
      type: "lowpass",
    });
    // Zero and below are clamped too rather than failing the whole patch.
    for (const value of [0, -5]) {
      expect(filtered({ frequency: value, Q: value })).toEqual({
        frequency: 20,
        Q: 0.1,
        type: "lowpass",
      });
    }
    // Not a number at all: there is nothing to clamp.
    expect(filtered({ frequency: Number.NaN })).toBeNull();
    expect(filtered({ Q: Number.POSITIVE_INFINITY })).toBeNull();
  });

  test("keeps a pinned flag and the viewport", () => {
    const raw = migratedLayout();
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
    ["a string version", { ...migratedLayout(), version: "1" }],
    ["version 0", migratedLayout(0)],
    ["a fractional version", migratedLayout(1.5)],
  ])("rejects %s", (_label, raw) => {
    expect(migrateNodeGraph(raw).status).toBe("invalid");
  });

  test.each([
    [
      "an unknown node type",
      (raw: ReturnType<typeof migratedLayout>) => ({
        ...raw,
        nodes: [...raw.nodes, { id: "x", position, type: "theremin" }],
      }),
    ],
    [
      "a missing node list",
      (raw: ReturnType<typeof migratedLayout>) => ({
        ...raw,
        nodes: undefined,
      }),
    ],
    [
      "a duplicate node id",
      (raw: ReturnType<typeof migratedLayout>) => ({
        ...raw,
        nodes: [...raw.nodes, { id: "speakers", position, type: "speakers" }],
      }),
    ],
    [
      "a duplicate edge id",
      (raw: ReturnType<typeof migratedLayout>) => ({
        ...raw,
        edges: [...raw.edges, raw.edges[0]],
      }),
    ],
    [
      "a cable to a missing node",
      (raw: ReturnType<typeof migratedLayout>) => ({
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
      (raw: ReturnType<typeof migratedLayout>) => ({
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
      "a strip trim above +12 dB",
      (raw: ReturnType<typeof migratedLayout>) => ({
        ...raw,
        nodes: [
          {
            data: { radio: null, strip: { trimDb: 18 } },
            id: "hot",
            position,
            type: "station",
          },
        ],
      }),
    ],
    [
      "a Track speed past 2x",
      (raw: ReturnType<typeof migratedLayout>) => ({
        ...raw,
        nodes: [
          {
            data: { radio: null, strip: { speed: 4 } },
            id: "fast",
            position,
            type: "platform",
          },
        ],
      }),
    ],
    [
      "an effect that does not match its node type",
      (raw: ReturnType<typeof migratedLayout>) => ({
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
      "an effect inside a Split that has the node's id",
      (raw: ReturnType<typeof migratedLayout>) => {
        const split = createNodeEffectConfig("fxComposite", "old-id");
        const [chain, ...rest] = split.chains;
        return {
          ...raw,
          nodes: [
            ...raw.nodes,
            {
              data: {
                effect: {
                  ...split,
                  chains: [
                    {
                      ...chain,
                      effects: [createNodeEffectConfig("delay", "split")],
                    },
                    ...rest,
                  ],
                },
              },
              id: "split",
              position,
              type: "fxComposite",
            },
          ],
        };
      },
    ],
    [
      "a cable louder than +12 dB",
      (raw: ReturnType<typeof migratedLayout>) => ({
        ...raw,
        edges: [{ ...raw.edges[0], gain: 1000 }],
      }),
    ],
    [
      "a Loop feedback above 0.95",
      (raw: ReturnType<typeof migratedLayout>) => ({
        ...raw,
        nodes: [{ data: { feedback: 1 }, id: "loop", position, type: "loop" }],
      }),
    ],
  ])("rejects %s", (_label, corrupt) => {
    const result = migrateNodeGraph(corrupt(migratedLayout()));
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.error.length).toBeGreaterThan(
      0
    );
  });

  test("marks an unknown future version read-only", () => {
    const result = migrateNodeGraph(migratedLayout(NODE_GRAPH_VERSION + 1));
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

describe("stripForType", () => {
  test("keeps what strips share when a source changes type", () => {
    const track = { ...DEFAULT_MEDIA_STRIP, pan: 0.5, speed: 1.5, trimDb: -6 };
    expect(stripForType("station", track)).toEqual({
      pan: 0.5,
      solo: false,
      trimDb: -6,
    });
    expect(stripForType("file", track)).toEqual(track);
    expect(
      stripForType("platform", { pan: -1, solo: true, trimDb: 3 })
    ).toEqual({ ...DEFAULT_MEDIA_STRIP, pan: -1, solo: true, trimDb: 3 });
    expect(stripForType("deviceIn")).toEqual(DEFAULT_INPUT_STRIP);
  });
});
