import { describe, expect, mock, test } from "bun:test";
import {
  connectNodes,
  moveNodes,
  removeNodes,
  setStationsEnabled,
} from "./graph-edits";
import {
  commitNodeGraph,
  createNodeStore,
  getRetainedNodeGraphs,
  loadNodeGraph,
  NODE_HISTORY_LIMIT,
  type NodeStore,
  redoNodeGraph,
  setNodeSelection,
  snapshotNodeGraph,
  undoNodeGraph,
} from "./node-store";
import type { NodeGraph } from "./schema";
import {
  AUDIO_IN_HANDLE,
  AUDIO_OUT_HANDLE,
  buildNodeGraphFromTemplate,
  SPEAKERS_NODE_ID,
} from "./templates";

const graph = buildNodeGraphFromTemplate("start-from-multiple", {
  session: [
    { id: "a", name: "A", streamUrl: "https://radio.example/a.mp3" },
    { id: "b", name: "B", streamUrl: "https://radio.example/b.mp3" },
  ],
});

describe("node store", () => {
  test("a commit without a loaded patch does nothing", () => {
    const store = createNodeStore();

    expect(commitNodeGraph((current) => current, store)).toBe(false);
    expect(store.state.graph).toBeNull();
  });

  test("loading a patch clears the selection", () => {
    const store = createNodeStore(graph);
    setNodeSelection({ edges: [], nodes: ["src-a"] }, store);

    loadNodeGraph(graph, store);

    expect(store.state.selection).toEqual({ edges: [], nodes: [] });
  });

  test("a commit drops selected nodes and cables that are gone", () => {
    const store = createNodeStore(graph);
    setNodeSelection(
      { edges: ["src-a->speakers"], nodes: ["src-a", "src-b"] },
      store
    );

    commitNodeGraph(
      (current) => ({
        ...current,
        edges: current.edges.filter((edge) => edge.source !== "src-a"),
        nodes: current.nodes.filter((node) => node.id !== "src-a"),
      }),
      store
    );

    expect(store.state.selection).toEqual({ edges: [], nodes: ["src-b"] });
  });

  test("an unchanged commit and a selection change leave the graph alone", () => {
    const store = createNodeStore(graph);
    const listener = mock(() => undefined);
    store.subscribe(listener);
    listener.mockClear();

    commitNodeGraph((current) => current, store);
    expect(listener).not.toHaveBeenCalled();

    setNodeSelection({ edges: [], nodes: ["src-b"] }, store);
    expect(store.state.graph).toBe(graph);
  });
});

function setStationVolume(current: NodeGraph, id: string, volume: number) {
  return {
    ...current,
    nodes: current.nodes.map((node) =>
      node.id === id && node.type === "station"
        ? { ...node, data: { ...node.data, volume } }
        : node
    ),
  };
}

function volumeOf(store: NodeStore, id: string): number | undefined {
  const node = store.state.graph?.nodes.find((entry) => entry.id === id);
  return node?.type === "station" ? node.data.volume : undefined;
}

describe("node store undo", () => {
  test("retained documents include current edits, snapshots and redo, without duplicates", () => {
    const store = createNodeStore(graph);
    const blank = buildNodeGraphFromTemplate("blank");
    commitNodeGraph(() => blank, store, "snapshot");
    undoNodeGraph(store);
    const edited = setStationVolume(graph, "src-a", 0.4);
    commitNodeGraph(() => edited, store);

    expect(getRetainedNodeGraphs(store.state)).toEqual(
      new Set([graph, blank, edited])
    );

    loadNodeGraph(null, store);
    expect(getRetainedNodeGraphs(store.state).size).toBe(0);
  });

  test("undo and redo restore the graph across delete, connect and template load", () => {
    const store = createNodeStore(graph);

    commitNodeGraph(
      (current) => removeNodes(current, ["src-a"]),
      store,
      "snapshot"
    );
    const deleted = store.state.graph;
    commitNodeGraph(
      (current) =>
        connectNodes(
          { ...current, edges: [] },
          {
            source: "src-b",
            sourceHandle: AUDIO_OUT_HANDLE,
            target: SPEAKERS_NODE_ID,
            targetHandle: AUDIO_IN_HANDLE,
          }
        ),
      store,
      "snapshot"
    );
    const connected = store.state.graph;
    const blank = buildNodeGraphFromTemplate("blank");
    commitNodeGraph(() => blank, store, "snapshot");

    expect(undoNodeGraph(store)).toBe(true);
    expect(store.state.graph).toBe(connected);
    expect(undoNodeGraph(store)).toBe(true);
    expect(store.state.graph).toBe(deleted);
    expect(undoNodeGraph(store)).toBe(true);
    expect(store.state.graph).toBe(graph);
    expect(undoNodeGraph(store)).toBe(false);

    expect(redoNodeGraph(store)).toBe(true);
    expect(store.state.graph).toBe(deleted);
    expect(redoNodeGraph(store)).toBe(true);
    expect(redoNodeGraph(store)).toBe(true);
    expect(store.state.graph).toBe(blank);
    expect(redoNodeGraph(store)).toBe(false);
  });

  test("a drag stop is one step", () => {
    const store = createNodeStore(graph);
    commitNodeGraph(
      (current) => moveNodes(current, new Map([["src-a", { x: 40, y: 40 }]])),
      store,
      "snapshot"
    );

    undoNodeGraph(store);

    expect(store.state.graph).toBe(graph);
  });

  test("undo and redo drop a selection that is gone", () => {
    const store = createNodeStore(graph);
    commitNodeGraph(
      (current) => removeNodes(current, ["src-b"]),
      store,
      "snapshot"
    );
    undoNodeGraph(store);
    setNodeSelection({ edges: [], nodes: ["src-a", "src-b"] }, store);

    redoNodeGraph(store);

    expect(store.state.selection.nodes).toEqual(["src-a"]);
  });

  test("a fader drag is one step, taken on release", () => {
    const store = createNodeStore(graph);
    for (const volume of [0.9, 0.7, 0.5]) {
      commitNodeGraph(
        (current) => setStationVolume(current, "src-a", volume),
        store
      );
    }
    snapshotNodeGraph(store);

    undoNodeGraph(store);
    expect(volumeOf(store, "src-a")).toBe(1);
    redoNodeGraph(store);
    expect(volumeOf(store, "src-a")).toBe(0.5);
  });

  test("edits since the last snapshot are undone first", () => {
    const store = createNodeStore(graph);
    commitNodeGraph(
      (current) => setStationVolume(current, "src-a", 0.4),
      store
    );
    commitNodeGraph(
      (current) => removeNodes(current, ["src-b"]),
      store,
      "snapshot"
    );

    undoNodeGraph(store);
    expect(volumeOf(store, "src-b")).toBe(1);
    expect(volumeOf(store, "src-a")).toBe(0.4);
    undoNodeGraph(store);
    expect(store.state.graph).toBe(graph);
  });

  test("a new edit clears redo", () => {
    const store = createNodeStore(graph);
    commitNodeGraph(
      (current) => removeNodes(current, ["src-a"]),
      store,
      "snapshot"
    );
    undoNodeGraph(store);

    commitNodeGraph(
      (current) => removeNodes(current, ["src-b"]),
      store,
      "snapshot"
    );

    expect(redoNodeGraph(store)).toBe(false);
    expect(store.state.history.future).toEqual([]);
  });

  test("a rebased edit reaches every snapshot and is no undo step", () => {
    const store = createNodeStore(graph);
    commitNodeGraph(
      (current) => removeNodes(current, ["src-b"]),
      store,
      "snapshot"
    );
    undoNodeGraph(store);
    commitNodeGraph(
      (current) => setStationsEnabled(current, ["src-a"], false),
      store,
      "rebase"
    );

    const hidden = (entry: NodeGraph | null) => {
      const node = entry?.nodes.find((candidate) => candidate.id === "src-a");
      return node?.type === "station" ? node.data.radio?.enabled : undefined;
    };
    expect(hidden(store.state.graph)).toBe(false);
    expect(store.state.history.present).toBe(store.state.graph);
    expect(store.state.history.past).toEqual([]);
    expect(redoNodeGraph(store)).toBe(true);
    expect(hidden(store.state.graph)).toBe(false);
  });

  test("a rebased edit reaches a deleted Station that undo brings back", () => {
    const store = createNodeStore(graph);
    commitNodeGraph(
      (current) => removeNodes(current, ["src-a"]),
      store,
      "snapshot"
    );
    const deleted = store.state.graph;

    // The station is hidden while its Station is gone from the patch.
    commitNodeGraph(
      (current) => setStationsEnabled(current, ["src-a"], false),
      store,
      "rebase"
    );
    expect(store.state.graph).toBe(deleted);

    undoNodeGraph(store);
    const restored = store.state.graph?.nodes.find(
      (node) => node.id === "src-a"
    );
    expect(
      restored?.type === "station" ? restored.data.radio?.enabled : undefined
    ).toBe(false);
  });

  test("keeps the last 100 steps", () => {
    const store = createNodeStore(graph);
    for (let step = 1; step <= NODE_HISTORY_LIMIT + 20; step += 1) {
      commitNodeGraph(
        (current) => setStationVolume(current, "src-a", step / 1000),
        store,
        "snapshot"
      );
    }

    expect(store.state.history.past).toHaveLength(NODE_HISTORY_LIMIT);
    let undone = 0;
    while (undoNodeGraph(store)) {
      undone += 1;
    }
    expect(undone).toBe(NODE_HISTORY_LIMIT);
    expect(volumeOf(store, "src-a")).toBe(20 / 1000);
  });

  test("loading a patch starts a fresh history", () => {
    const store = createNodeStore(graph);
    commitNodeGraph(
      (current) => removeNodes(current, ["src-a"]),
      store,
      "snapshot"
    );

    loadNodeGraph(graph, store);

    expect(undoNodeGraph(store)).toBe(false);
  });
});
