import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio/playback/types";
import { compile } from "./compile";
import {
  addStationNode,
  connectNodes,
  DUPLICATE_OFFSET_PX,
  duplicateNodes,
  findStationNode,
  type GraphEdit,
  insertNodeOnEdge,
  moveNodes,
  removeEdges,
  removeNodes,
  removeNodesHealed,
  removeSelection,
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
import { addPaletteNode } from "./palette";
import { diff } from "./reconcile";
import type { EffectNodeType, NodeGraph, NodeType } from "./schema";
import { seriesToParallel } from "./series-parallel";
import {
  buildNodeGraphFromTemplate,
  SPEAKERS_NODE_ID,
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

function accepted(edit: GraphEdit): NodeGraph {
  if (!edit.ok) {
    throw new Error(edit.message);
  }
  return edit.graph;
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
    addPaletteNode(start, {
      id: type,
      kind: "node",
      name: type,
      section: "fx",
      type,
    }).graph;
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

/** A loose node of `type` added to `graph`, as the palette adds it. */
function withLoose(graph: NodeGraph, type: NodeType) {
  const added = addPaletteNode(graph, {
    id: type,
    kind: "node",
    name: type,
    section: "fx",
    type,
  });
  return { graph: added.graph, nodeId: added.nodeId ?? "" };
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

    // A Filter belongs right after its station, not after an FX.
    const filter = withLoose(start, "filter");
    const late = insertNodeOnEdge(
      filter.graph,
      filter.nodeId,
      "compressor->speakers"
    );
    expect(late.ok).toBe(false);
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

  test("refuses deleting a Merge when its branches cannot heal to Speakers", () => {
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
    expect(before.edges.size).toBe(1);
    expect(before.issues).toEqual([]);

    // Branches straight into Speakers would never rejoin in the lane.
    const edit = removeNodesHealed(split.graph, [merge?.id ?? ""]);

    expect(edit.ok).toBe(false);
    if (edit.ok) {
      throw new Error("A failed heal must refuse the whole deletion");
    }
    expect(edit.message).toContain("disconnecting a source from its output");

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
    expect(store.state).toBe(state);
    expect(undoNodeGraph(store)).toBe(false);
    expect(compile(store.state.graph as NodeGraph, ENV).edges.size).toBe(1);

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
    expect(compile(wholeBranch, ENV).edges.size).toBe(1);
  });

  test("refuses deleting a Merge that would drop a hidden Station's route", () => {
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
    expect(compile(hidden, ENV).edges.size).toBe(0);

    const edit = removeNodesHealed(hidden, [merge?.id ?? ""]);

    expect(edit.ok).toBe(false);
  });

  test("deleting a loose node or one with no output is allowed", () => {
    const loose = withLoose(patch(radio("a")), "compressor");
    const deleted = accepted(removeNodesHealed(loose.graph, [loose.nodeId]));
    expect(deleted.nodes.some((node) => node.id === loose.nodeId)).toBe(false);
    expect(compile(deleted, ENV).edges.size).toBe(1);

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

  test("B toggles the FX's on switch and issues only setLaneEffects", () => {
    const bypassed = toggleBypass(start, ["compressor", "src-a"]);

    expect(effectIn(bypassed, "compressor").enabled).toBe(false);
    const ops = diff(compile(start, ENV), compile(bypassed, ENV));
    expect(ops.map((op) => op.type)).toEqual(["setLaneEffects"]);

    const back = toggleBypass(bypassed, ["compressor"]);
    expect(effectIn(back, "compressor").enabled).toBe(true);
    expect(
      diff(compile(bypassed, ENV), compile(back, ENV)).map((op) => op.type)
    ).toEqual(["setLaneEffects"]);
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

    expect(nodeIds).toEqual(["src-a-2", "compressor-2"]);
    expect(graph.nodes.slice(0, start.nodes.length)).toEqual(start.nodes);
    const copy = graph.nodes.find((node) => node.id === "compressor-2");
    const original = start.nodes.find((node) => node.id === "compressor");
    expect(copy?.position).toEqual({
      x: (original?.position.x ?? 0) + DUPLICATE_OFFSET_PX,
      y: (original?.position.y ?? 0) + DUPLICATE_OFFSET_PX,
    });
    expect(effectIn(graph, "compressor-2").id).toBe("compressor-2");
    expect(cables(graph).slice(start.edges.length)).toEqual([
      "src-a-2->compressor-2: src-a-2 out:audio:main -> compressor-2 in:audio:main",
      "compressor-2->speakers: compressor-2 out:audio:main -> speakers in:audio:main",
    ]);
    expect(validate(graph)).toEqual([]);
    expect([...compile(graph, ENV).lanes.keys()]).toEqual(["src-a", "src-a-2"]);
  });

  test("a copied Station comes wired to Speakers; a copy can't take a full input", () => {
    const start = inserted(
      patch(radio("a")),
      "compressor",
      "src-a->speakers"
    ).graph;

    const station = duplicateNodes(patch(radio("a")), ["src-a"]);
    expect(cables(station.graph).at(-1)).toBe(
      "src-a-2->speakers: src-a-2 out:audio:main -> speakers in:audio:main"
    );

    const feeding = duplicateNodes(start, ["src-a"]);
    expect(feeding.graph.edges).toHaveLength(start.edges.length);
    expect(feeding.nodeIds).toEqual(["src-a-2"]);

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

    expect(nodeIds).toEqual(["compressor-2"]);
    expect(graph.edges).toEqual(start.edges);
    const edit = insertNodeOnEdge(graph, "compressor-2", "src-b->speakers");
    expect(edit.ok).toBe(true);
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
