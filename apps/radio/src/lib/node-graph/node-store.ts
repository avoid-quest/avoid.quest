/**
 * Node Store
 *
 * The patch being edited: the graph document, the canvas selection and the
 * undo stack, in a TanStack Store like the playback runtime store. React
 * Flow is controlled from it, and node playback compiles each graph commit
 * onto the engine, so an undo is just another diff. Meter-rate levels never
 * pass through here.
 */

import { Store, useStore } from "@tanstack/react-store";
import {
  getNodeGraphReadOnlyVersion,
  type NodeGraph,
  type NodeGraphMigration,
} from "./schema";

export type NodeSelection = {
  nodes: readonly string[];
  edges: readonly string[];
};

/**
 * Snapshots of the document. `present` is the graph as of the last
 * snapshot; commits since then (a fader mid-drag) fold into the next step.
 */
export type NodeHistory = {
  past: readonly NodeGraph[];
  present: NodeGraph | null;
  future: readonly NodeGraph[];
};

export type NodeStoreState = {
  /** null until a node session is loaded. */
  graph: NodeGraph | null;
  /** A newer stored patch is preserved, with no editable or playable graph. */
  readOnlyVersion: number | null;
  selection: NodeSelection;
  history: NodeHistory;
};

export type NodeStore = Store<NodeStoreState>;

/**
 * How a commit meets the undo stack:
 * - "snapshot": an undo step of its own (connect, delete, add, template);
 * - "rebase": applied to every snapshot too, for edits that follow live
 *   records (a rename, a hide), so no undo brings a stale record back;
 * - default: folds into the next snapshot (a fader mid-drag).
 */
export type NodeCommitHistory = "snapshot" | "rebase";

/** Snapshots kept for undo. */
export const NODE_HISTORY_LIMIT = 100;

const EMPTY_SELECTION: NodeSelection = { edges: [], nodes: [] };

function freshHistory(graph: NodeGraph | null): NodeHistory {
  return { future: [], past: [], present: graph };
}

export function createNodeStore(graph: NodeGraph | null = null): NodeStore {
  const readOnlyVersion = getNodeGraphReadOnlyVersion(graph);
  const editableGraph = readOnlyVersion === null ? graph : null;
  return new Store<NodeStoreState>({
    graph: editableGraph,
    history: freshHistory(editableGraph),
    readOnlyVersion,
    selection: EMPTY_SELECTION,
  });
}

export const nodeStore = createNodeStore();

/** Documents whose local resources can still return through Undo or Redo. */
export function getRetainedNodeGraphs(
  state: NodeStoreState = nodeStore.state
): ReadonlySet<NodeGraph> {
  return new Set(
    [
      state.graph,
      state.history.present,
      ...state.history.past,
      ...state.history.future,
    ].filter((graph): graph is NodeGraph => graph !== null)
  );
}

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

/** Makes the current graph an undo step if it moved since the last one. */
function checkpoint(state: NodeStoreState): NodeHistory {
  const { history, graph } = state;
  if (graph === history.present) {
    return history;
  }
  const past = history.present ? [...history.past, history.present] : [];
  return {
    future: [],
    past: past.slice(-NODE_HISTORY_LIMIT),
    present: graph,
  };
}

/** Replaces the document, e.g. when the node session activates. */
export function loadNodeGraph(
  graph: NodeGraph | null,
  store: NodeStore = nodeStore,
  readOnlyVersion: number | null = getNodeGraphReadOnlyVersion(graph)
): void {
  const editableGraph = readOnlyVersion === null ? graph : null;
  store.setState(() => ({
    graph: editableGraph,
    history: freshHistory(editableGraph),
    readOnlyVersion,
    selection: EMPTY_SELECTION,
  }));
}

/**
 * Takes in another tab's newer patch. Like a load it is no undo step and
 * starts a fresh history, since a step recorded against the older patch
 * would bring back what the other tab changed. The selection keeps what
 * still exists.
 */
export function adoptNodeGraph(
  graph: NodeGraph,
  store: NodeStore = nodeStore
): void {
  store.setState((state) => ({
    graph,
    history: freshHistory(graph),
    readOnlyVersion: null,
    selection: pruneSelection(state.selection, graph),
  }));
}

/** Carries the storage migration's read-only result through to the editor. */
export function loadNodeGraphMigration(
  migration: NodeGraphMigration,
  store: NodeStore = nodeStore
): void {
  loadNodeGraph(
    migration.status === "ok" ? migration.graph : null,
    store,
    migration.status === "read-only" ? migration.version : null
  );
}

/**
 * Commits an edit to the document. Returns false when no patch is loaded;
 * returning the same graph from `update` commits nothing.
 */
export function commitNodeGraph(
  update: (graph: NodeGraph) => NodeGraph,
  store: NodeStore = nodeStore,
  history?: NodeCommitHistory
): boolean {
  const current = store.state.graph;
  if (!current || store.state.readOnlyVersion !== null) {
    return false;
  }
  const graph = update(current);
  if (graph === current) {
    // A rebased edit can still reach snapshots, e.g. a hide for a Station
    // that was deleted and could come back on undo.
    if (history === "rebase") {
      const rebased = rebaseHistory(
        store.state.history,
        update,
        current,
        graph
      );
      if (rebased !== store.state.history) {
        store.setState((state) => ({ ...state, history: rebased }));
      }
    }
    return true;
  }
  store.setState((state) => {
    const next = { ...state, graph };
    if (history === "snapshot") {
      // Anything uncommitted before the edit is its own step first.
      const before = checkpoint(state);
      next.history = checkpoint({ ...state, graph, history: before });
    } else if (history === "rebase") {
      next.history = rebaseHistory(state.history, update, current, graph);
    }
    return { ...next, selection: pruneSelection(state.selection, graph) };
  });
  return true;
}

/**
 * Applies `update` to every snapshot. The current graph maps to the
 * committed one, so a rebased edit alone never looks like an undo step.
 * Returns the same history when no snapshot changed.
 */
function rebaseHistory(
  history: NodeHistory,
  update: (graph: NodeGraph) => NodeGraph,
  current: NodeGraph,
  graph: NodeGraph
): NodeHistory {
  let changed = false;
  const rebase = (entry: NodeGraph) => {
    const next = entry === current ? graph : update(entry);
    changed ||= next !== entry;
    return next;
  };
  const rebased: NodeHistory = {
    future: history.future.map(rebase),
    past: history.past.map(rebase),
    present: history.present && rebase(history.present),
  };
  return changed ? rebased : history;
}

/** Makes the edits since the last snapshot one undo step (a knob release). */
export function snapshotNodeGraph(store: NodeStore = nodeStore): void {
  if (store.state.graph === store.state.history.present) {
    return;
  }
  store.setState((state) => ({ ...state, history: checkpoint(state) }));
}

/** Steps back one snapshot. Returns false when there is nothing to undo. */
export function undoNodeGraph(store: NodeStore = nodeStore): boolean {
  if (store.state.readOnlyVersion !== null) {
    return false;
  }
  const history = checkpoint(store.state);
  const previous = history.past.at(-1);
  if (!(previous && history.present)) {
    return false;
  }
  const { present } = history;
  store.setState((state) => ({
    ...state,
    graph: previous,
    history: {
      future: [present, ...history.future],
      past: history.past.slice(0, -1),
      present: previous,
    },
    selection: pruneSelection(state.selection, previous),
  }));
  return true;
}

/** Steps forward one undone snapshot, unless the patch changed since. */
export function redoNodeGraph(store: NodeStore = nodeStore): boolean {
  if (store.state.readOnlyVersion !== null) {
    return false;
  }
  const { graph, history } = store.state;
  const [next, ...future] = history.future;
  if (!(next && graph) || graph !== history.present) {
    return false;
  }
  store.setState((state) => ({
    ...state,
    graph: next,
    history: {
      future,
      past: [...history.past, graph].slice(-NODE_HISTORY_LIMIT),
      present: next,
    },
    selection: pruneSelection(state.selection, next),
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

export function useNodeReadOnlyVersion(
  store: NodeStore = nodeStore
): number | null {
  return useStore(store, (state) => state.readOnlyVersion);
}

export function useNodeSelection(store: NodeStore = nodeStore): NodeSelection {
  return useStore(store, (state) => state.selection);
}

/** Whether Undo and Redo have anything to do, for their buttons. */
export function useNodeHistory(store: NodeStore = nodeStore): {
  canUndo: boolean;
  canRedo: boolean;
} {
  const canUndo = useStore(
    store,
    ({ graph, history }) =>
      history.past.length > 0 ||
      (graph !== history.present && history.present !== null)
  );
  const canRedo = useStore(
    store,
    ({ graph, history }) =>
      history.future.length > 0 && graph === history.present
  );
  return { canRedo, canUndo };
}
