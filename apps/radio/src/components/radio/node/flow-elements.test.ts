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

  test("a node or cable drawn the same as last time is handed back as it was", () => {
    const options = { measured: new Map(), positions: new Map(), selection };
    const before = toFlowNodes(patch, options);
    const after = toFlowNodes(patch, {
      ...options,
      positions: new Map([["src-kexp", { x: 5, y: 5 }]]),
    });
    const edgeOptions = { liveLanes: new Set<string>(), selection };
    const cables = toFlowEdges(patch, edgeOptions);

    expect(after.map((node, index) => node === before[index])).toEqual([
      false,
      true,
      true,
    ]);
    expect(
      toFlowEdges(patch, edgeOptions).every(
        (edge, index) => edge === cables[index]
      )
    ).toBe(true);
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
      mergeRoles: new Map([["mix", "closes"]]),
      positions: new Map(),
      selection,
    }).find((node) => node.id === "mix");
    expect(merge?.data).toEqual({ inputs: 2, role: "closes" });
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

  test("a branch whose chain is muted or turned down stops the live glow", () => {
    const wire = (id: string, source: string, target: string) => ({
      id,
      source,
      sourceHandle: "out:audio:main",
      target,
      targetHandle: "in:audio:main",
    });
    const split = createNodeEffectConfig("fxComposite", "split");
    const graph = (chain: { muted?: boolean; gain?: number }): NodeGraph =>
      nodeGraphSchema.parse({
        ...patch,
        edges: [
          wire("kexp->split", "src-kexp", "split"),
          {
            ...wire("split->comp", "split", "comp"),
            sourceHandle: "out:audio:branch-1",
          },
          wire("comp->speakers", "comp", "speakers"),
        ],
        nodes: [
          ...patch.nodes,
          {
            data: {
              effect: {
                ...split,
                chains: split.chains.map((entry, index) =>
                  index === 0 ? { ...entry, ...chain } : entry
                ),
              },
            },
            id: "split",
            position: { x: 240, y: 0 },
            type: "fxComposite",
          },
          {
            data: { effect: createNodeEffectConfig("compressor", "comp") },
            id: "comp",
            position: { x: 480, y: 0 },
            type: "compressor",
          },
        ],
      });
    const classes = (chain: { muted?: boolean; gain?: number }) =>
      Object.fromEntries(
        toFlowEdges(graph(chain), {
          liveLanes: new Set(["n:src-kexp"]),
          selection,
        }).map((edge) => [edge.id, edge.className])
      );

    expect(classes({})).toMatchObject({
      "comp->speakers": "node-edge-live",
      "split->comp": "node-edge-live",
    });
    for (const silent of [{ muted: true }, { gain: 0 }]) {
      expect(classes(silent)).toMatchObject({
        "comp->speakers": undefined,
        "kexp->split": "node-edge-live",
        "split->comp": undefined,
      });
    }
  });

  test("a source another's solo mutes stops the live glow, as the compiler mutes its exits", () => {
    const graph: NodeGraph = nodeGraphSchema.parse({
      ...patch,
      nodes: patch.nodes.map((node) =>
        node.id === "src-nts"
          ? {
              ...node,
              data: {
                ...node.data,
                strip: {
                  ...(node.data as { strip: object }).strip,
                  solo: true,
                },
              },
            }
          : node
      ),
    });
    const plan = compile(graph, { crossOriginIsolated: false });
    const classes = Object.fromEntries(
      toFlowEdges(graph, {
        liveLanes: new Set(["n:src-kexp", "n:src-nts"]),
        mix: plan,
        selection,
      }).map((edge) => [edge.id, edge.className])
    );

    expect(classes).toEqual({
      "src-kexp->speakers": undefined,
      "src-nts->speakers": "node-edge-live",
    });
    expect(plan.cables.get("src-kexp->speakers")?.muted).toBe(true);
    expect(plan.cables.get("src-nts->speakers")?.muted).toBe(false);
  });

  test("source solo plus an active key keeps the key cable live", () => {
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
          id: "nts->speakers",
          source: "src-nts",
          sourceHandle: "out:audio:main",
          target: "speakers",
          targetHandle: "in:audio:main",
        },
        {
          id: "nts->key",
          source: "src-nts",
          sourceHandle: "out:audio:main",
          target: "comp",
          targetHandle: "in:sidechain:key",
        },
      ],
      nodes: [
        ...patch.nodes.map((node) =>
          node.id === "src-kexp"
            ? {
                ...node,
                data: {
                  ...node.data,
                  strip: {
                    ...(node.data as { strip: object }).strip,
                    solo: true,
                  },
                },
              }
            : node
        ),
        {
          data: {
            effect: {
              ...createNodeEffectConfig("compressor", "comp"),
              enabled: true,
            },
          },
          id: "comp",
          position: { x: 240, y: 0 },
          type: "compressor",
        },
      ],
    });
    const plan = compile(graph, { crossOriginIsolated: false });
    const idle = idleKeys(graph, plan);
    const classes = Object.fromEntries(
      toFlowEdges(graph, {
        idleKeys: idle,
        liveLanes: new Set(["n:src-kexp", "n:src-nts"]),
        mix: plan,
        selection,
      }).map((edge) => [edge.id, edge.className])
    );

    // NTS is soloed off air, yet its playing lane still keys the Compressor.
    expect(idle).toEqual(new Map());
    expect(classes).toEqual({
      "comp->speakers": "node-edge-live",
      "kexp->comp": "node-edge-live",
      "nts->key": "node-edge-key node-edge-key-live",
      "nts->speakers": undefined,
    });
  });

  test("a key lights while its compiled point hears audio: a lane soloed off air still keys from its FX", () => {
    const wire = (
      id: string,
      source: string,
      target: string,
      extra: object = {}
    ) => ({
      id,
      source,
      sourceHandle: "out:audio:main",
      target,
      targetHandle: "in:audio:main",
      ...extra,
    });
    const effect = (id: string, type: "compressor" | "cheapReverb") => ({
      data: {
        effect: { ...createNodeEffectConfig(type, id), enabled: true },
      },
      id,
      position: { x: 240, y: 0 },
      type,
    });
    const keyClass = (solo: boolean, via: "lane" | "split") => {
      const graph: NodeGraph = nodeGraphSchema.parse({
        ...patch,
        edges: [
          wire("kexp->comp", "src-kexp", "comp"),
          wire("comp->speakers", "comp", "speakers"),
          ...(via === "lane"
            ? [wire("nts->verb", "src-nts", "verb")]
            : [
                wire("nts->split", "src-nts", "split"),
                wire("split->verb", "split", "verb", {
                  sourceHandle: "out:audio:branch-1",
                }),
                wire("split->desk", "split", "desk", {
                  sourceHandle: "out:audio:branch-2",
                }),
              ]),
          wire("verb->speakers", "verb", "speakers"),
          wire("verb->key", "verb", "comp", {
            targetHandle: "in:sidechain:key",
          }),
        ],
        nodes: [
          ...patch.nodes.map((node) =>
            node.id === "src-kexp"
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    strip: { ...(node.data as { strip: object }).strip, solo },
                  },
                }
              : node
          ),
          effect("comp", "compressor"),
          effect("verb", "cheapReverb"),
          {
            data: { effect: createNodeEffectConfig("fxComposite", "split") },
            id: "split",
            position: { x: 120, y: 0 },
            type: "fxComposite",
          },
          {
            data: { deviceId: "usb" },
            id: "desk",
            position: { x: 480, y: 200 },
            type: "deviceOut",
          },
        ],
      });
      const plan = compile(graph, { crossOriginIsolated: false });
      return toFlowEdges(graph, {
        idleKeys: idleKeys(graph, plan),
        liveLanes: new Set(["n:src-kexp", "n:src-nts"]),
        mix: plan,
        selection,
      }).find((edge) => edge.id === "verb->key")?.className;
    };

    for (const via of ["lane", "split"] as const) {
      expect(keyClass(false, via)).toBe("node-edge-key node-edge-key-live");
    }
    // The Reverb folds into NTS's lane, and KEXP's solo leaves the lane's
    // key tap on: the Compressor still hears the Reverb.
    expect(keyClass(true, "lane")).toBe("node-edge-key node-edge-key-live");
    // Past a Split the Reverb is a point of its own, and KEXP's solo mutes
    // NTS into it, so the Reverb's key is quiet.
    expect(keyClass(true, "split")).toBe("node-edge-key");
  });

  test("a branch another branch's solo silences stops the live glow", () => {
    const wire = (
      id: string,
      source: string,
      target: string,
      extra: object = {}
    ) => ({
      id,
      source,
      sourceHandle: "out:audio:main",
      target,
      targetHandle: "in:audio:main",
      ...extra,
    });
    const split = createNodeEffectConfig("fxComposite", "split");
    const graph = (
      branches: { handle: string; target: string; solo?: boolean }[],
      chainSolo = false
    ): NodeGraph =>
      nodeGraphSchema.parse({
        ...patch,
        edges: [
          wire("kexp->split", "src-kexp", "split"),
          ...branches.map(({ handle, target, solo }) =>
            wire(`split->${target}`, "split", target, {
              sourceHandle: `out:audio:${handle}`,
              ...(solo ? { solo } : {}),
            })
          ),
          ...[...new Set(branches.map(({ target }) => target))].map((target) =>
            wire(`${target}->merge`, target, "merge")
          ),
          wire("merge->speakers", "merge", "speakers"),
        ],
        nodes: [
          ...patch.nodes,
          {
            data: {
              effect: {
                ...split,
                chains: split.chains.map((chain, index) =>
                  index === 1 ? { ...chain, solo: chainSolo } : chain
                ),
                enabled: true,
              },
            },
            id: "split",
            position: { x: 240, y: 0 },
            type: "fxComposite",
          },
          {
            data: { effect: createNodeEffectConfig("compressor", "comp") },
            id: "comp",
            position: { x: 480, y: 0 },
            type: "compressor",
          },
          {
            data: { effect: createNodeEffectConfig("gate", "gate") },
            id: "gate",
            position: { x: 480, y: 200 },
            type: "gate",
          },
          {
            data: { effect: createNodeEffectConfig("cheapReverb", "verb") },
            id: "verb",
            position: { x: 480, y: 400 },
            type: "cheapReverb",
          },
          {
            data: {},
            id: "merge",
            position: { x: 720, y: 0 },
            type: "merge",
          },
        ],
      });
    const classes = (patched: NodeGraph) => {
      const { "kexp->split": _, ...rest } = Object.fromEntries(
        toFlowEdges(patched, {
          liveLanes: new Set(["n:src-kexp"]),
          mix: compile(patched, { crossOriginIsolated: false }),
          selection,
        })
          .filter((edge) => edge.source !== "src-nts")
          .map((edge) => [edge.id, edge.className])
      );
      return rest;
    };
    const compOnly = {
      "comp->merge": "node-edge-live",
      "gate->merge": undefined,
      "merge->speakers": "node-edge-live",
      "split->comp": "node-edge-live",
      "split->gate": undefined,
    };

    // A soloed branch cable.
    expect(
      classes(
        graph([
          { handle: "branch-1", solo: true, target: "comp" },
          { handle: "branch-2", target: "gate" },
        ])
      )
    ).toEqual(compOnly);
    // A soloed chain on the split itself.
    expect(
      classes(
        graph(
          [
            { handle: "branch-1", target: "gate" },
            { handle: "branch-2", target: "comp" },
          ],
          true
        )
      )
    ).toEqual(compOnly);
    // Two cables on one port: the soloed one plays.
    expect(
      classes(
        graph([
          { handle: "branch-1", solo: true, target: "comp" },
          { handle: "branch-1", target: "gate" },
        ])
      )
    ).toEqual(compOnly);
    // A soloed cable on one port and a soloed chain on another: both play,
    // and only the branch with neither is left out.
    expect(
      classes(
        graph(
          [
            { handle: "branch-1", solo: true, target: "comp" },
            { handle: "branch-2", target: "gate" },
            { handle: "branch-3", target: "verb" },
          ],
          true
        )
      )
    ).toEqual({
      "comp->merge": "node-edge-live",
      "gate->merge": "node-edge-live",
      "merge->speakers": "node-edge-live",
      "split->comp": "node-edge-live",
      "split->gate": "node-edge-live",
      "split->verb": undefined,
      "verb->merge": undefined,
    });
    // No solo: every branch plays.
    expect(
      classes(
        graph([
          { handle: "branch-1", target: "comp" },
          { handle: "branch-2", target: "gate" },
        ])
      )
    ).toEqual({
      "comp->merge": "node-edge-live",
      "gate->merge": "node-edge-live",
      "merge->speakers": "node-edge-live",
      "split->comp": "node-edge-live",
      "split->gate": "node-edge-live",
    });
  });

  test("a Split's dry signal keeps glowing past a soloed branch that plays nothing, until its output trim turns it down", () => {
    const wire = (
      id: string,
      source: string,
      target: string,
      extra: object = {}
    ) => ({
      id,
      source,
      sourceHandle: "out:audio:main",
      target,
      targetHandle: "in:audio:main",
      ...extra,
    });
    const split = createNodeEffectConfig("fxComposite", "split");
    const classes = (
      dryWet: number,
      into: "merge" | "desk",
      { enabled = true, outputGain = 1, outputMoves = false } = {}
    ) => {
      const graph: NodeGraph = nodeGraphSchema.parse({
        ...patch,
        edges: [
          ...(outputMoves
            ? [
                {
                  depth: 0.25,
                  id: "macro->split",
                  parameter: "outputGain",
                  source: "macro",
                  sourceHandle: "out:control:main",
                  target: "split",
                  targetHandle: "in:control:parameter",
                },
              ]
            : []),
          wire("kexp->split", "src-kexp", "split"),
          // The soloed branch is muted, so only the dry signal plays.
          wire("split->comp", "split", "comp", {
            muted: true,
            solo: true,
            sourceHandle: "out:audio:branch-1",
          }),
          wire("split->gate", "split", "gate", {
            sourceHandle: "out:audio:branch-2",
          }),
          wire("comp->merge", "comp", "merge"),
          wire(`gate->${into}`, "gate", into),
          wire("merge->speakers", "merge", "speakers"),
        ],
        nodes: [
          ...patch.nodes,
          {
            data: { effect: { ...split, dryWet, enabled, outputGain } },
            id: "split",
            position: { x: 240, y: 0 },
            type: "fxComposite",
          },
          { id: "macro", position: { x: 0, y: 200 }, type: "macro" },
          {
            data: { effect: createNodeEffectConfig("compressor", "comp") },
            id: "comp",
            position: { x: 480, y: 0 },
            type: "compressor",
          },
          {
            data: { effect: createNodeEffectConfig("gate", "gate") },
            id: "gate",
            position: { x: 480, y: 200 },
            type: "gate",
          },
          { data: {}, id: "merge", position: { x: 720, y: 0 }, type: "merge" },
          {
            data: { deviceId: "usb" },
            id: "desk",
            position: { x: 720, y: 200 },
            type: "deviceOut",
          },
        ],
      });
      return Object.fromEntries(
        toFlowEdges(graph, {
          liveLanes: new Set(["n:src-kexp"]),
          mix: compile(graph, { crossOriginIsolated: false }),
          selection,
        })
          .filter((edge) => edge.source !== "src-nts")
          .map((edge) => [edge.id, edge.className])
      );
    };

    // Closed: the dry signal skips the branches and joins at the Merge.
    expect(classes(0.5, "merge")).toEqual({
      "comp->merge": undefined,
      "gate->merge": undefined,
      "kexp->split": "node-edge-live",
      "merge->speakers": "node-edge-live",
      "split->comp": undefined,
      "split->gate": undefined,
    });
    expect(classes(1, "merge")["merge->speakers"]).toBeUndefined();
    // Open: the dry signal rides beside each port's cables to their ends.
    expect(classes(0.5, "desk")).toEqual({
      "comp->merge": "node-edge-live",
      "gate->desk": "node-edge-live",
      "kexp->split": "node-edge-live",
      "merge->speakers": "node-edge-live",
      "split->comp": "node-edge-live",
      "split->gate": "node-edge-live",
    });
    expect(classes(1, "desk")).toMatchObject({
      "gate->desk": undefined,
      "merge->speakers": undefined,
    });
    // The output trim turns the dry signal down with the wet, unless it
    // moves; a switched-off Split passes everything, its trim and all.
    for (const into of ["merge", "desk"] as const) {
      expect(classes(0.5, into, { outputGain: 0 })).toMatchObject({
        "merge->speakers": undefined,
        "split->comp": undefined,
      });
      for (const settings of [
        { outputGain: 0, outputMoves: true },
        { enabled: false, outputGain: 0 },
      ]) {
        expect(classes(0.5, into, settings)["merge->speakers"]).toBe(
          "node-edge-live"
        );
      }
    }
    expect(classes(0.5, "desk", { outputGain: 0 })["gate->desk"]).toBe(
      undefined
    );
  });

  test("an open Split's muted or silent cable glows while the dry signal beside it plays, as the compiler leaves the dry cable untrimmed", () => {
    const split = createNodeEffectConfig("fxComposite", "split");
    const mixOf = (dryWet: number, trim: object, through: "gate" | "desk") => {
      const graph: NodeGraph = nodeGraphSchema.parse({
        ...patch,
        edges: [
          {
            id: "kexp->split",
            source: "src-kexp",
            sourceHandle: "out:audio:main",
            target: "split",
            targetHandle: "in:audio:main",
          },
          {
            id: "split->out",
            source: "split",
            sourceHandle: "out:audio:branch-1",
            target: through,
            targetHandle: "in:audio:main",
            ...trim,
          },
          {
            id: "split->speakers",
            source: "split",
            sourceHandle: "out:audio:branch-2",
            target: "speakers",
            targetHandle: "in:audio:main",
          },
          {
            id: "gate->desk",
            source: "gate",
            sourceHandle: "out:audio:main",
            target: "desk",
            targetHandle: "in:audio:main",
          },
        ],
        nodes: [
          ...patch.nodes,
          {
            data: { effect: { ...split, dryWet, enabled: true } },
            id: "split",
            position: { x: 240, y: 0 },
            type: "fxComposite",
          },
          {
            data: {
              effect: {
                ...createNodeEffectConfig("gate", "gate"),
                enabled: true,
              },
            },
            id: "gate",
            position: { x: 480, y: 0 },
            type: "gate",
          },
          {
            data: { deviceId: "usb" },
            id: "desk",
            position: { x: 720, y: 0 },
            type: "deviceOut",
          },
        ],
      });
      const plan = compile(graph, { crossOriginIsolated: false });
      const dry = [...plan.cables.values()].find(
        (cable) => cable.edges.length === 0 && cable.from.port === 0
      );
      const glow = toFlowEdges(graph, {
        liveLanes: new Set(["n:src-kexp"]),
        mix: plan,
        selection,
      }).find((edge) => edge.id === "split->out")?.className;
      return { dry: dry && { muted: dry.muted, to: dry.to.id }, glow };
    };

    // Through an FX or straight to an output, the cable's own mute or gain
    // stays on its wet signal; the dry cable beside it plays on.
    for (const trim of [{ muted: true }, { gain: 0 }]) {
      for (const through of ["gate", "desk"] as const) {
        expect(mixOf(0.5, trim, through)).toEqual({
          dry: { muted: false, to: "desk" },
          glow: "node-edge-live",
        });
        expect(mixOf(1, trim, through)).toEqual({
          dry: undefined,
          glow: undefined,
        });
      }
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
