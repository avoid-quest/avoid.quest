/**
 * Node Store
 *
 * The patch being edited: the graph document and the canvas selection, in a
 * TanStack Store like the playback runtime store. React Flow is controlled
 * from it, and node playback compiles each graph commit onto the engine.
 * Meter-rate levels never pass through here.
 */

import { Store, useStore } from "@tanstack/react-store";
import type { NodeGraph } from "./schema";

export type NodeSelection = {
  nodes: readonly string[];
  edges: readonly string[];
};

export type NodeStoreState = {
  /** null until a node session is loaded. */
  graph: NodeGraph | null;
  selection: NodeSelection;
};

export type NodeStore = Store<NodeStoreState>;

const EMPTY_SELECTION: NodeSelection = { edges: [], nodes: [] };

export function createNodeStore(graph: NodeGraph | null = null): NodeStore {
  return new Store<NodeStoreState>({ graph, selection: EMPTY_SELECTION });
}

export const nodeStore = createNodeStore();

/** Keeps only selected ids that still exist in `graph`. */
function pruneSelection(
  selection: NodeSelection,
  graph: NodeGraph
): NodeSelection {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));
  const nodes = selection.nodes.filter((id) => nodeIds.has(id));
  const edges = selection.edges.filter((id) => edgeIds.has(id));
  return nodes.length === selection.nodes.length &&
    edges.length === selection.edges.length
    ? selection
    : { edges, nodes };
}

/** Replaces the document, e.g. when the node session activates. */
export function loadNodeGraph(
  graph: NodeGraph | null,
  store: NodeStore = nodeStore
): void {
  store.setState(() => ({ graph, selection: EMPTY_SELECTION }));
}

/**
 * Commits an edit to the document. Returns false when no patch is loaded;
 * returning the same graph from `update` commits nothing.
 */
export function commitNodeGraph(
  update: (graph: NodeGraph) => NodeGraph,
  store: NodeStore = nodeStore
): boolean {
  const current = store.state.graph;
  if (!current) {
    return false;
  }
  const graph = update(current);
  if (graph === current) {
    return true;
  }
  store.setState((state) => ({
    graph,
    selection: pruneSelection(state.selection, graph),
  }));
  return true;
}

export function setNodeSelection(
  selection: NodeSelection,
  store: NodeStore = nodeStore
): void {
  store.setState((state) => ({ ...state, selection }));
}

export function useNodeGraph(store: NodeStore = nodeStore): NodeGraph | null {
  return useStore(store, (state) => state.graph);
}

export function useNodeSelection(store: NodeStore = nodeStore): NodeSelection {
  return useStore(store, (state) => state.selection);
}
