import { describe, expect, test } from "bun:test";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import { compile, idleKeys } from "@/lib/node-graph/compile";
import { type NodeGraph, nodeGraphSchema } from "@/lib/node-graph/schema";
import {
  buildNodeGraphFromTemplate,
  DUCK_NODE_ID,
} from "@/lib/node-graph/templates";
import {
  DRAWN_NODE_TYPES,
  dropTargetOf,
  edgeUnderPointer,
  facingPort,
  NODE_ARIA_LABELS,
  toFlowEdges,
  toFlowNodes,
} from "./flow-elements";

const patch = buildNodeGraphFromTemplate("start-from-multiple", {
  saved: [
    {
      enabled: true,
      id: "kexp",
      name: "KEXP",
      streamUrl: "https://radio.example/kexp.mp3",
    },
    {
      enabled: true,
      id: "nts",
      name: "NTS 1",
      streamUrl: "https://radio.example/nts.mp3",
    },
  ],
});
const selection = { edges: [], nodes: [] };

describe("flow elements", () => {
  test("cables are named by what they carry and where it goes", () => {
    const edges = toFlowEdges(patch, {
      liveLanes: new Set(["n:src-kexp"]),
      selection,
    });

    expect(edges.map((edge) => edge.ariaLabel)).toEqual([
      "KEXP audio to Speakers input",
      "NTS 1 audio to Speakers input",
    ]);
    expect(edges[0]?.domAttributes).toEqual({
      "aria-roledescription": "cable",
    });
    expect(edges.map((edge) => edge.className)).toEqual([
      "node-edge-live",
      undefined,
    ]);
  });

  test("nodes are audio modules, and the keyboard hint names C", () => {
    const nodes = toFlowNodes(patch, {
      measured: new Map(),
      positions: new Map(),
      selection,
    });

    expect(
      nodes.every(
        (node) =>
          node.domAttributes?.["aria-roledescription"] === "audio module"
      )
    ).toBe(true);
    expect(nodes.map((node) => node.ariaLabel)).toEqual([
      "KEXP",
      "NTS 1",
      "Speakers",
    ]);
    expect(nodes.find((node) => node.id === "speakers")?.deletable).toBe(false);
    expect(NODE_ARIA_LABELS["node.a11yDescription.default"]).toContain(
      "C to connect"
    );
  });

  test("a touch drop is found under the finger, not where the touch began", () => {
    const port = { closest: () => null, id: "port" };
    const pane = { closest: () => null, id: "pane" };
    const seen: [number, number][] = [];
    const doc = {
      elementFromPoint: (x: number, y: number) => {
        seen.push([x, y]);
        return pane as unknown as Element;
      },
    };
    const touchEnd = {
      changedTouches: [{ clientX: 120, clientY: 340 }],
      target: port,
    } as unknown as TouchEvent;

    expect(dropTargetOf(touchEnd, undefined, doc)).toBe(
      pane as unknown as Element
    );
    expect(seen).toEqual([[120, 340]]);
  });

  test("a drop falls back to the event target when nothing is hit", () => {
    const port = { closest: () => null };
    const mouseUp = {
      clientX: 4,
      clientY: 8,
      target: port,
    } as unknown as MouseEvent;

    expect(
      dropTargetOf(mouseUp, undefined, { elementFromPoint: () => null })
    ).toBe(port as unknown as Element);
  });

  test("only a port facing the cable counts as the port let go on", () => {
    const port = (side: "source" | "target") =>
      ({
        classList: { contains: (name: string) => name === side },
        getAttribute: (name: string) =>
          name === "data-nodeid" ? "verb" : `${side}-handle`,
      }) as unknown as Element;

    expect(facingPort(port("target"), { type: "source" })).toEqual({
      handle: "target-handle",
      node: "verb",
    });
    expect(facingPort(port("source"), { type: "source" })).toEqual({
      handle: null,
      node: null,
    });
    expect(facingPort(port("source"), { type: "target" })).toEqual({
      handle: "source-handle",
      node: "verb",
    });
    expect(facingPort(null, { type: "target" })).toEqual({
      handle: null,
      node: null,
    });
  });

  test("the cable under a dragged node is found beneath the node", () => {
    const element = (edgeId: string | null) =>
      ({
        closest: (selector: string) =>
          selector === ".react-flow__edge" && edgeId
            ? { getAttribute: () => edgeId }
            : null,
      }) as unknown as Element;
    const seen: [number, number][] = [];
    const doc = {
      elementsFromPoint: (x: number, y: number) => {
        seen.push([x, y]);
        return [element(null), element("src-kexp->speakers")];
      },
    };

    expect(edgeUnderPointer({ x: 10, y: 20 }, doc)).toBe("src-kexp->speakers");
    expect(seen).toEqual([[10, 20]]);
    expect(
      edgeUnderPointer({ x: 0, y: 0 }, { elementsFromPoint: () => [] })
    ).toBeNull();
    expect(edgeUnderPointer({ x: 0, y: 0 }, {} as Document)).toBeNull();
  });

  test("the cable a dragged node would go into is marked", () => {
    const edges = toFlowEdges(patch, {
      insertTarget: "src-nts->speakers",
      liveLanes: new Set(["n:src-nts"]),
      selection,
    });

    expect(
      edges.find((edge) => edge.id === "src-nts->speakers")?.className
    ).toBe("node-edge-live node-edge-insert");
    expect(
      edges.find((edge) => edge.id === "src-kexp->speakers")?.className
    ).toBeUndefined();
  });

  test("FX, the splits, Merge and the native strip are drawn; Werkstatt waits", () => {
    expect(DRAWN_NODE_TYPES).toContain("compressor");
    expect(DRAWN_NODE_TYPES).toContain("fxComposite");
    expect(DRAWN_NODE_TYPES).toContain("frequencySplit");
    expect(DRAWN_NODE_TYPES).toContain("merge");
    expect(DRAWN_NODE_TYPES).toContain("pan");
    expect(DRAWN_NODE_TYPES).not.toContain("werkstatt");
  });

  test("a split's cables are branches carrying their params, and a Merge gets its badge", () => {
    const graph: NodeGraph = nodeGraphSchema.parse({
      ...patch,
      edges: [
        {
          id: "kexp->lr",
          source: "src-kexp",
          sourceHandle: "out:audio:main",
          target: "lr",
          targetHandle: "in:audio:main",
        },
        {
          gain: 0.5,
          id: "lr.left",
          pan: -1,
          solo: true,
          source: "lr",
          sourceHandle: "out:audio:left",
          target: "mix",
          targetHandle: "in:audio:main",
        },
        {
          id: "lr.right",
          muted: true,
          source: "lr",
          sourceHandle: "out:audio:right",
          target: "mix",
          targetHandle: "in:audio:main",
        },
        {
          id: "mix->speakers",
          source: "mix",
          sourceHandle: "out:audio:main",
          target: "speakers",
          targetHandle: "in:audio:main",
        },
      ],
      nodes: [
        ...patch.nodes,
        {
          data: { effect: createNodeEffectConfig("stereoSplit", "lr") },
          id: "lr",
          position: { x: 0, y: 0 },
          type: "stereoSplit",
        },
        { data: {}, id: "mix", position: { x: 0, y: 0 }, type: "merge" },
      ],
    });
    const edges = toFlowEdges(graph, { liveLanes: new Set(), selection });

    expect(
      edges.map((edge) => [edge.id, edge.type ?? "default", edge.data])
    ).toEqual([
      ["kexp->lr", "default", undefined],
      [
        "lr.left",
        "branch",
        {
          baseGain: 1,
          basePan: 0,
          gain: 0.5,
          muted: false,
          name: "Left",
          pan: -1,
          solo: true,
          tag: "L",
        },
      ],
      [
        "lr.right",
        "branch",
        {
          baseGain: 1,
          basePan: 0,
          gain: 1,
          muted: true,
          name: "Right",
          pan: 0,
          solo: false,
          tag: "R",
        },
      ],
      ["mix->speakers", "default", undefined],
    ]);
    const merge = toFlowNodes(graph, {
      measured: new Map(),
      mergeRoles: new Map([["mix", "in-lane"]]),
      positions: new Map(),
      selection,
    }).find((node) => node.id === "mix");
    expect(merge?.data).toEqual({ inputs: 2, role: "in-lane" });
  });

  test("a playing Station's cables stay live through its FX, key cables don't", () => {
    const graph: NodeGraph = nodeGraphSchema.parse({
      ...patch,
      edges: [
        {
          id: "kexp->comp",
          source: "src-kexp",
          sourceHandle: "out:audio:main",
          target: "comp",
          targetHandle: "in:audio:main",
        },
        {
          id: "comp->speakers",
          source: "comp",
          sourceHandle: "out:audio:main",
          target: "speakers",
          targetHandle: "in:audio:main",
        },
        {
          id: "kexp->key",
          source: "src-kexp",
          sourceHandle: "out:audio:main",
          target: "gate",
          targetHandle: "in:sidechain:key",
        },
        {
          id: "nts->gate",
          source: "src-nts",
          sourceHandle: "out:audio:main",
          target: "gate",
          targetHandle: "in:audio:main",
        },
      ],
      nodes: [
        ...patch.nodes,
        {
          data: { effect: createNodeEffectConfig("compressor", "comp") },
          id: "comp",
          position: { x: 240, y: 0 },
          type: "compressor",
        },
        {
          data: { effect: createNodeEffectConfig("gate", "gate") },
          id: "gate",
          position: { x: 240, y: 200 },
          type: "gate",
        },
      ],
    });

    const edges = toFlowEdges(graph, {
      liveLanes: new Set(["n:src-kexp"]),
      selection,
    });

    expect(
      Object.fromEntries(edges.map((edge) => [edge.id, edge.className]))
    ).toEqual({
      "comp->speakers": "node-edge-live",
      "kexp->comp": "node-edge-live",
      // A key never glows Live; its playing station thickens it instead.
      "kexp->key": "node-edge-key node-edge-key-live",
      "nts->gate": undefined,
    });
    expect(
      toFlowNodes(graph, {
        measured: new Map(),
        positions: new Map(),
        selection,
      }).find((node) => node.id === "comp")
    ).toMatchObject({ ariaLabel: "Compressor", type: "compressor" });
  });

  test("a muted or silent cable stops the live glow, and so does what it feeds", () => {
    const wire = (id: string, source: string, target: string) => ({
      id,
      source,
      sourceHandle: "out:audio:main",
      target,
      targetHandle: "in:audio:main",
    });
    const graph = (cable: { muted?: boolean; gain?: number }): NodeGraph =>
      nodeGraphSchema.parse({
        ...patch,
        edges: [
          { ...wire("kexp->comp", "src-kexp", "comp"), ...cable },
          wire("comp->speakers", "comp", "speakers"),
        ],
        nodes: [
          ...patch.nodes,
          {
            data: { effect: createNodeEffectConfig("compressor", "comp") },
            id: "comp",
            position: { x: 240, y: 0 },
            type: "compressor",
          },
        ],
      });
    const classes = (cable: { muted?: boolean; gain?: number }) =>
      Object.fromEntries(
        toFlowEdges(graph(cable), {
          liveLanes: new Set(["n:src-kexp"]),
          selection,
        }).map((edge) => [edge.id, edge.className])
      );

    expect(classes({})).toEqual({
      "comp->speakers": "node-edge-live",
      "kexp->comp": "node-edge-live",
    });
    for (const silent of [{ muted: true }, { gain: 0 }]) {
      expect(classes(silent)).toEqual({
        "comp->speakers": undefined,
        "kexp->comp": undefined,
      });
    }
  });

  test("the module description React Flow reads names the arrow keys, and B only for effects", () => {
    // React Flow reads `keyboardDisabled` while keyboard access is on.
    const read = NODE_ARIA_LABELS["node.a11yDescription.keyboardDisabled"];
    const off = NODE_ARIA_LABELS["node.a11yDescription.default"];

    expect(read).toContain("arrow keys");
    expect(off).not.toContain("arrow keys");
    for (const description of [read, off]) {
      expect(description).toContain("an effect");
      expect(description).not.toContain("bypass it");
      expect(description).not.toContain("bypasses it");
    }
  });

  test("key cables draw as keys, and an idle one says why", () => {
    const duck = buildNodeGraphFromTemplate("duck", {
      saved: [
        {
          enabled: true,
          id: "kexp",
          name: "KEXP",
          streamUrl: "https://radio.example/kexp.mp3",
        },
      ],
    });
    const plan = compile(duck, { crossOriginIsolated: false });
    const key = (graph: NodeGraph, idle: ReadonlyMap<string, string>) =>
      toFlowEdges(graph, { idleKeys: idle, liveLanes: new Set(), selection })
        .filter((edge) => edge.type === "key")
        .map(({ ariaLabel, className, data, target }) => ({
          ariaLabel,
          className,
          data,
          target,
        }));

    // The talk slot is empty, so the Compressor has nothing to listen to.
    expect(key(duck, idleKeys(duck, plan))).toEqual([
      {
        ariaLabel:
          "Empty Station audio to Compressor key input, not keying: The station slot is empty",
        className: "node-edge-key node-edge-key-idle",
        data: { idle: "The station slot is empty" },
        target: DUCK_NODE_ID,
      },
    ]);
    expect(key(duck, new Map())).toEqual([
      expect.objectContaining({
        className: "node-edge-key",
        data: { idle: null },
      }),
    ]);
  });
});
