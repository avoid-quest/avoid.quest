/**
 * Cable Surgery Shortcuts
 *
 * Pure Data style keyboard surgery on the patch, each edit one undo step:
 * - Delete or Backspace removes the selection, healing the paths through it;
 * - B bypasses the selected FX, or turns them back on;
 * - I inserts into the selected cable: the one loose node selected with it,
 *   or else a node picked from the palette;
 * - Cmd+D (Ctrl+D elsewhere) duplicates the selected nodes.
 * Keys act from the canvas or with nothing focused, never from a field, a
 * dialog, the Stage or the Rack. Lives outside the canvas chunk's React
 * Flow imports, so it is testable without them.
 */

import { type RefObject, useEffect } from "react";
import { toast } from "sonner";
import {
  duplicateNodes,
  insertNodeOnEdge,
  isLoose,
  removeSelection,
  toggleBypass,
} from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  type NodeStore,
  nodeStore,
  setNodeSelection,
} from "@/lib/node-graph/node-store";
import type { NodeGraph } from "@/lib/node-graph/schema";
import type { ValidateOptions } from "@/lib/node-graph/validate";
import { isCanvasKey, type PaletteRequest } from "./node-palette";

const DELETE_KEYS = ["Backspace", "Delete"];

/** Halfway between a cable's two nodes, where a node picked for it lands. */
export function cableMidpoint(
  graph: NodeGraph,
  edgeId: string
): { x: number; y: number } | undefined {
  const edge = graph.edges.find((entry) => entry.id === edgeId);
  const source = graph.nodes.find((node) => node.id === edge?.source);
  const target = graph.nodes.find((node) => node.id === edge?.target);
  if (!(source && target)) {
    return;
  }
  return {
    x: (source.position.x + target.position.x) / 2,
    y: (source.position.y + target.position.y) / 2,
  };
}

/** The node a key was pressed on, if it came from inside one. */
function focusedNode(target: EventTarget | null): string | null {
  return target instanceof Element
    ? (target.closest(".react-flow__node")?.getAttribute("data-id") ?? null)
    : null;
}

/** The selected nodes; with none selected, the focused one. */
function targetNodes(store: NodeStore, target: EventTarget | null): string[] {
  const { nodes } = store.state.selection;
  if (nodes.length > 0) {
    return [...nodes];
  }
  const focused = focusedNode(target);
  return focused ? [focused] : [];
}

export type CableSurgeryOptions = {
  /** The canvas; keys count from inside it, or with nothing focused. */
  canvasRef: RefObject<HTMLElement | null>;
  /** I with a cable alone selected: pick what goes into it. */
  onInsertInto: (request: PaletteRequest) => void;
  validateOptions?: ValidateOptions;
  store?: NodeStore;
};

type Surgery = {
  onInsertInto: (request: PaletteRequest) => void;
  validateOptions?: ValidateOptions;
  store: NodeStore;
};

type SurgeryKey = (event: KeyboardEvent, surgery: Surgery) => void;

const remove: SurgeryKey = (event, { store, validateOptions }) => {
  const selected = store.state.selection;
  if (selected.nodes.length === 0 && selected.edges.length === 0) {
    return;
  }
  event.preventDefault();
  commitNodeGraph(
    (latest) => removeSelection(latest, selected, validateOptions),
    store,
    "snapshot"
  );
};

const bypass: SurgeryKey = (event, { store }) => {
  const ids = targetNodes(store, event.target);
  if (ids.length === 0) {
    return;
  }
  event.preventDefault();
  commitNodeGraph((latest) => toggleBypass(latest, ids), store, "snapshot");
};

const insert: SurgeryKey = (
  event,
  { store, validateOptions, onInsertInto }
) => {
  const { graph, selection } = store.state;
  const [edgeId] = selection.edges;
  if (!(graph && edgeId) || selection.edges.length !== 1) {
    return;
  }
  event.preventDefault();
  const [nodeId] = selection.nodes;
  if (!(nodeId && selection.nodes.length === 1 && isLoose(graph, nodeId))) {
    onInsertInto({ into: edgeId, position: cableMidpoint(graph, edgeId) });
    return;
  }
  const edit = insertNodeOnEdge(graph, nodeId, edgeId, validateOptions);
  if (!edit.ok) {
    toast(edit.message);
    return;
  }
  commitNodeGraph(() => edit.graph, store, "snapshot");
  setNodeSelection({ edges: [], nodes: [nodeId] }, store);
};

const duplicate: SurgeryKey = (event, { store, validateOptions }) => {
  const ids = targetNodes(store, event.target);
  if (ids.length === 0) {
    return;
  }
  // Also keeps the browser's bookmark dialog away.
  event.preventDefault();
  let copies: string[] = [];
  commitNodeGraph(
    (latest) => {
      const result = duplicateNodes(latest, ids, validateOptions);
      copies = result.nodeIds;
      return result.graph;
    },
    store,
    "snapshot"
  );
  if (copies.length > 0) {
    setNodeSelection({ edges: [], nodes: copies }, store);
  }
};

/** The edit a key stands for; a held B or I repeats nothing. */
function surgeryFor(event: KeyboardEvent): SurgeryKey | null {
  const key = event.key.toLowerCase();
  if (event.metaKey || event.ctrlKey) {
    return key === "d" && !event.shiftKey ? duplicate : null;
  }
  if (DELETE_KEYS.includes(event.key)) {
    return remove;
  }
  if (event.repeat) {
    return null;
  }
  if (key === "b") {
    return bypass;
  }
  return key === "i" ? insert : null;
}

export function useCableSurgeryShortcuts({
  canvasRef,
  onInsertInto,
  validateOptions,
  store = nodeStore,
}: CableSurgeryOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        !isCanvasKey(event.target, canvasRef.current)
      ) {
        return;
      }
      surgeryFor(event)?.(event, { onInsertInto, store, validateOptions });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canvasRef, onInsertInto, store, validateOptions]);
}
