/**
 * Flow Elements
 *
 * The patch as React Flow's controlled nodes and edges, with the names a
 * screen reader hears: each node is an "audio module", each cable reads
 * like "KEXP audio to Speakers input". Types only from the adapter, so this
 * stays testable without the canvas chunk.
 */

import { laneChannelId } from "@/lib/node-graph/compile";
import { edgeLabel } from "@/lib/node-graph/describe";
import type { NodeSelection } from "@/lib/node-graph/node-store";
import type { GraphNode, NodeGraph } from "@/lib/node-graph/schema";
import type { FlowAriaLabelConfig, FlowEdge, FlowNode } from "./flow-adapter";

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/** The node types the canvas draws today. */
export const DRAWN_NODE_TYPES = ["speakers", "station"] as const;
type DrawnType = (typeof DRAWN_NODE_TYPES)[number];

export function isDrawn(
  node: GraphNode
): node is GraphNode & { type: DrawnType } {
  return (DRAWN_NODE_TYPES as readonly string[]).includes(node.type);
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

export function toFlowNodes(
  graph: NodeGraph,
  {
    selection,
    positions,
    measured,
  }: {
    selection: NodeSelection;
    /** Positions mid-drag, not yet committed. */
    positions: ReadonlyMap<string, Point>;
    measured: ReadonlyMap<string, Size>;
  }
): FlowNode[] {
  return graph.nodes.filter(isDrawn).map((node) => ({
    data: node.data,
    deletable: node.type !== "speakers",
    domAttributes: { "aria-roledescription": "audio module" },
    id: node.id,
    measured: measured.get(node.id),
    position: positions.get(node.id) ?? node.position,
    selected: selection.nodes.includes(node.id),
    type: node.type,
  }));
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
  const drawn = new Set(graph.nodes.filter(isDrawn).map((node) => node.id));
  return graph.edges
    .filter((edge) => drawn.has(edge.source) && drawn.has(edge.target))
    .map((edge) => ({
      ariaLabel: edgeLabel(graph, edge),
      className: liveLanes.has(laneChannelId(edge.source))
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
