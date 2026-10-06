import { getNodeDefinition } from "./catalogue";
import type { EdgePlan, LanePlan } from "./compile";
import type { GraphEdge, GraphNode, NodeGraph } from "./schema";
import type { Issue, Lane, WiredEdge } from "./validate";

export type AudioPatchPlan = {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
};

/** These patches need actual shared processors and separate output paths. */
export function needsAudioPatch(
  graph: Pick<NodeGraph, "nodes" | "edges">,
  wired: readonly WiredEdge[],
  lanes: ReadonlyMap<string, Lane>,
  nativeIssues: readonly Issue[]
): boolean {
  if (nativeIssues.length > 0 || [...lanes.values()].includes(null)) {
    return true;
  }
  const natives = new Set<string>();
  const inputs = new Set<string>();
  if (
    wired.some(
      (wire) =>
        wire.to.kind === "sidechain" ||
        graph.nodes.some(
          (node) => node.id === wire.edge.target && node.type === "follower"
        )
    )
  ) {
    return true;
  }
  for (const node of graph.nodes) {
    if (
      (node.type === "filter" || node.type === "pan") &&
      typeof lanes.get(node.id) === "string"
    ) {
      const key = `${lanes.get(node.id)}:${node.type}`;
      if (natives.has(key)) {
        return true;
      }
      natives.add(key);
    }
  }
  for (const wire of wired) {
    if (wire.to.kind !== "audio") {
      continue;
    }
    const target = graph.nodes.find((node) => node.id === wire.edge.target);
    if (
      !target ||
      target.type === "merge" ||
      getNodeDefinition(target.type).category === "output"
    ) {
      continue;
    }
    if (inputs.has(target.id)) {
      return true;
    }
    inputs.add(target.id);
  }
  return false;
}

/** Only validated audio wires enter the runtime. Control routing is independent. */
export function audioPatchPlan(
  graph: Pick<NodeGraph, "nodes">,
  wired: readonly WiredEdge[]
): AudioPatchPlan {
  const edges = wired.filter((wire) => wire.from.kind === "audio");
  const used = new Set(edges.flatMap(({ edge }) => [edge.source, edge.target]));
  return {
    edges: new Map(edges.map(({ edge }) => [edge.id, edge])),
    nodes: new Map(
      graph.nodes
        .filter((node) => used.has(node.id))
        .map((node) => [node.id, node])
    ),
  };
}

/** Source-to-output reachability remains available to cable surgery and the UI. */
export function patchRoutes(
  patch: AudioPatchPlan,
  lanes: ReadonlyMap<string, LanePlan>
): Map<string, EdgePlan> {
  const routes = new Map<string, EdgePlan>();
  const outs = new Map<string, GraphEdge[]>();
  for (const edge of patch.edges.values()) {
    if (edge.targetHandle.startsWith("in:audio:")) {
      outs.set(edge.source, [...(outs.get(edge.source) ?? []), edge]);
    }
  }
  for (const lane of lanes.values()) {
    const pending = [lane.id];
    const seen = new Set<string>();
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const node = patch.nodes.get(id);
      if (node && getNodeDefinition(node.type).category === "output") {
        const routeId = `${lane.id}\u0000${id}`;
        routes.set(routeId, {
          from: { id: lane.id, kind: "lane" },
          gain: 1,
          id: routeId,
          muted: false,
          to: { id, kind: "sink" },
        });
      }
      pending.push(...(outs.get(id) ?? []).map((edge) => edge.target));
    }
  }
  return routes;
}

export function patchInputId(sourceId: string): string {
  return `audio-patch\u0000${sourceId}`;
}
