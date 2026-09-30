/**
 * Node Graph Labels
 *
 * The words screen readers and the Connect… dialog use for nodes, ports and
 * cables: "KEXP audio to Speakers input", "Compressor key input". Pure, so
 * the canvas, the dialog and their tests share one wording.
 */

import { getNodeDefinition, type NodePort } from "./catalogue";
import type { GraphEdge, GraphNode, NodeGraph } from "./schema";
import { parseHandleId } from "./validate";

/** A Station reads as its station; every other node as its type. */
export function nodeLabel(node: GraphNode | undefined): string {
  if (!node) {
    return "Missing node";
  }
  if (node.type === "station") {
    return node.data.radio?.name ?? "Empty Station";
  }
  return getNodeDefinition(node.type).name;
}

/** The port a handle id names on `node`, if it has one. */
export function portOf(
  node: GraphNode | undefined,
  handle: string | null | undefined
): NodePort | undefined {
  const parsed = parseHandleId(handle);
  if (!(node && parsed)) {
    return;
  }
  return getNodeDefinition(node.type).ports.find(
    (port) =>
      port.direction === parsed.direction &&
      port.kind === parsed.kind &&
      port.id === parsed.name
  );
}

/** Sentence case, keeping one-letter names such as Crossfade's "A". */
function sentence(label: string): string {
  return label.length > 1 ? label.toLowerCase() : label;
}

/**
 * A port as the end of a cable: "audio" for a main output, "input" for a
 * main input, otherwise its own name, e.g. "key input" or "branch 1".
 */
export function portPhrase(port: NodePort | undefined): string {
  if (!port) {
    return "port";
  }
  if (port.direction === "out") {
    return port.id === "main" ? port.kind : sentence(port.label);
  }
  return port.id === "main" ? "input" : `${sentence(port.label)} input`;
}

/** A port on its own node, for a picker: "Audio out", "Key input". */
export function portName(port: NodePort): string {
  const phrase =
    port.direction === "out" && port.id === "main"
      ? `${port.kind} out`
      : portPhrase(port);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** "KEXP audio" or "Speakers input": a node and one of its ports. */
export function endLabel(
  node: GraphNode | undefined,
  handle: string | null | undefined
): string {
  return `${nodeLabel(node)} ${portPhrase(portOf(node, handle))}`;
}

/** A cable's accessible name, e.g. "KEXP audio to Speakers input". */
export function edgeLabel(
  graph: Pick<NodeGraph, "nodes">,
  edge: Pick<GraphEdge, "source" | "sourceHandle" | "target" | "targetHandle">
): string {
  const source = graph.nodes.find((node) => node.id === edge.source);
  const target = graph.nodes.find((node) => node.id === edge.target);
  return `${endLabel(source, edge.sourceHandle)} to ${endLabel(target, edge.targetHandle)}`;
}
