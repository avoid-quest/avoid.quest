/**
 * Flow Elements
 *
 * The patch as React Flow's controlled nodes and edges, with the names a
 * screen reader hears: each node is an "audio module", each cable reads
 * like "KEXP audio to Speakers input". Types only from the adapter, so this
 * stays testable without the canvas chunk.
 */

import { branchName, branchTag, isSplitNode } from "@/lib/node-graph/branches";
import { getNodeDefinition, isShipped } from "@/lib/node-graph/catalogue";
import { laneChannelId, type MergeRole } from "@/lib/node-graph/compile";
import { edgeLabel, nodeLabel } from "@/lib/node-graph/describe";
import type { NodeSelection } from "@/lib/node-graph/node-store";
import {
  EFFECT_NODE_TYPES,
  type GraphEdge,
  type GraphNode,
  NATIVE_NODE_TYPES,
  type NodeGraph,
  type NodeType,
} from "@/lib/node-graph/schema";
import { parseHandleId } from "@/lib/node-graph/validate";
import type { FlowAriaLabelConfig, FlowEdge, FlowNode } from "./flow-adapter";

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/**
 * The node types the canvas draws today: Station, Speakers, the native
 * strip, every shipped effect (all but Werkstatt) with the splits, and the
 * Merge that closes them.
 */
export const DRAWN_NODE_TYPES: readonly NodeType[] = [
  "speakers",
  "station",
  "merge",
  ...NATIVE_NODE_TYPES,
  ...EFFECT_NODE_TYPES.filter((type) =>
    isShipped(getNodeDefinition(type).ship, "v1")
  ),
];

export function isDrawn(node: GraphNode): boolean {
  return DRAWN_NODE_TYPES.includes(node.type);
}

/** React Flow's announcements in the app's words. */
export const NODE_ARIA_LABELS: Partial<FlowAriaLabelConfig> = {
  "edge.a11yDescription.default":
    "Press Enter or Space to select this cable, then Delete to remove it.",
  "handle.ariaLabel": "Port",
  "node.a11yDescription.ariaLiveMessage": ({ direction, x, y }) =>
    `Moved the module ${direction} to ${Math.round(x)}, ${Math.round(y)}`,
  "node.a11yDescription.default":
    "Press Enter or Space to select this module, C to connect it, Delete to remove it and Escape to cancel.",
  "node.a11yDescription.keyboardDisabled":
    "Press Enter or Space to select this module, then the arrow keys to move it. C connects it, Delete removes it and Escape cancels.",
};

/** Where a mouse or touch gesture ended, in client pixels. */
export function pointerOf(event: MouseEvent | TouchEvent): Point {
  const point = "changedTouches" in event ? event.changedTouches[0] : event;
  return { x: point?.clientX ?? 0, y: point?.clientY ?? 0 };
}

/**
 * The element under the point where a cable was let go. A touch event's
 * target is where the touch began (the port the cable left), so the drop
 * is found by position instead.
 */
export function dropTargetOf(
  event: MouseEvent | TouchEvent,
  pointer: Point = pointerOf(event),
  doc: Pick<Document, "elementFromPoint"> | undefined = globalThis.document
): Element | null {
  const below = doc?.elementFromPoint(pointer.x, pointer.y);
  if (below) {
    return below;
  }
  const { target } = event;
  return target && "closest" in target ? (target as Element) : null;
}

/** What a Merge node draws: its compiler badge and how many cables it joins. */
export type MergeNodeData = { role: MergeRole | null; inputs: number };

/** What a branch cable draws: its tag, and the chain params it carries. */
export type BranchEdgeData = {
  tag: string;
  name: string;
  gain: number;
  muted: boolean;
  pan: number;
  solo: boolean;
};

function mergeData(
  graph: NodeGraph,
  node: GraphNode,
  roles: ReadonlyMap<string, MergeRole>
): MergeNodeData {
  return {
    inputs: graph.edges.filter(
      (edge) =>
        edge.target === node.id &&
        parseHandleId(edge.targetHandle)?.kind === "audio"
    ).length,
    role: roles.get(node.id) ?? null,
  };
}

export function toFlowNodes(
  graph: NodeGraph,
  {
    selection,
    positions,
    measured,
    mergeRoles = new Map(),
  }: {
    selection: NodeSelection;
    /** Positions mid-drag, not yet committed. */
    positions: ReadonlyMap<string, Point>;
    measured: ReadonlyMap<string, Size>;
    /** What the compiler made of each Merge. */
    mergeRoles?: ReadonlyMap<string, MergeRole>;
  }
): FlowNode[] {
  return graph.nodes.filter(isDrawn).map((node) => ({
    // Named like its cables, so "KEXP, audio module" rather than a bare role.
    ariaLabel: nodeLabel(node),
    data:
      node.type === "merge" ? mergeData(graph, node, mergeRoles) : node.data,
    deletable: node.type !== "speakers",
    domAttributes: { "aria-roledescription": "audio module" },
    id: node.id,
    measured: measured.get(node.id),
    position: positions.get(node.id) ?? node.position,
    selected: selection.nodes.includes(node.id),
    type: node.type,
  }));
}

/**
 * Nodes carrying a playing Station's audio: each live Station, and every
 * node its audio cables reach through FX, up to the outputs.
 */
export function liveNodeIds(
  graph: Pick<NodeGraph, "nodes" | "edges">,
  liveLanes: ReadonlySet<string>
): Set<string> {
  const live = new Set<string>();
  const queue = graph.nodes
    .filter(
      (node) => node.type === "station" && liveLanes.has(laneChannelId(node.id))
    )
    .map((node) => node.id);
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (live.has(id)) {
      continue;
    }
    live.add(id);
    for (const edge of graph.edges) {
      if (
        edge.source === id &&
        parseHandleId(edge.sourceHandle)?.kind === "audio" &&
        parseHandleId(edge.targetHandle)?.kind === "audio"
      ) {
        queue.push(edge.target);
      }
    }
  }
  return live;
}

/**
 * A cable leaving a split is a branch: drawn with its tag, and carrying the
 * chain's gain, pan, mute and solo. Other cables draw as plain wires.
 */
function branchOf(
  source: GraphNode | undefined,
  edge: GraphEdge
): Pick<FlowEdge, "data" | "type"> | null {
  if (
    !isSplitNode(source) ||
    parseHandleId(edge.targetHandle)?.kind !== "audio"
  ) {
    return null;
  }
  const data: BranchEdgeData = {
    gain: edge.gain,
    muted: edge.muted,
    name: branchName(source, edge.sourceHandle),
    pan: edge.pan ?? 0,
    solo: edge.solo === true,
    tag: branchTag(source, edge.sourceHandle),
  };
  return { data, type: "branch" };
}

export function toFlowEdges(
  graph: NodeGraph,
  {
    selection,
    liveLanes,
  }: {
    selection: NodeSelection;
    /** Channel ids of the lanes playing now. */
    liveLanes: ReadonlySet<string>;
  }
): FlowEdge[] {
  const drawn = new Map(
    graph.nodes.filter(isDrawn).map((node) => [node.id, node])
  );
  const live = liveNodeIds(graph, liveLanes);
  return graph.edges
    .filter((edge) => drawn.has(edge.source) && drawn.has(edge.target))
    .map((edge) => ({
      ...branchOf(drawn.get(edge.source), edge),
      ariaLabel: edgeLabel(graph, edge),
      // A key cable carries its station's audio as a detector, not on air.
      className:
        live.has(edge.source) &&
        parseHandleId(edge.targetHandle)?.kind === "audio"
          ? "node-edge-live"
          : undefined,
      domAttributes: { "aria-roledescription": "cable" },
      id: edge.id,
      selected: selection.edges.includes(edge.id),
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
    }));
}
