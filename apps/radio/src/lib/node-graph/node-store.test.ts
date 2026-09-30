import { describe, expect, mock, test } from "bun:test";
import {
  commitNodeGraph,
  createNodeStore,
  loadNodeGraph,
  setNodeSelection,
} from "./node-store";
import { buildNodeGraphFromTemplate } from "./templates";

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
