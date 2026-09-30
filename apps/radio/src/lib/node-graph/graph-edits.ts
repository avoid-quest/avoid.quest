/**
 * Graph Edits
 *
 * Pure edits the canvas commits to the node store: cables in and out, nodes
 * moved or removed, the viewport, and the Station edits behind search. The search bar adds
 * a Station wired to Speakers, an empty Station slot is filled in place, and
 * saved-station snapshots follow their records (a rename, a new stream, a
 * hide). Each returns the same graph when nothing changes, so a no-op
 * commits nothing.
 */

import type { Radio } from "@/lib/audio/playback/types";
import type { GraphEdge, GraphNode, NodeGraph } from "./schema";
import {
  AUDIO_IN_HANDLE,
  AUDIO_OUT_HANDLE,
  STATION_ROW_HEIGHT,
  stationNodeId,
} from "./templates";
import type { Connection } from "./validate";

type StationNode = Extract<GraphNode, { type: "station" }>;
type Position = GraphNode["position"];
type Viewport = NodeGraph["viewport"];

/** Where the first Station goes relative to Speakers: one column left. */
const FIRST_STATION_OFFSET_X = 480;

function isStation(node: GraphNode): node is StationNode {
  return node.type === "station";
}

/** `base`, suffixed until no id in `taken` has it. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) {
    id = `${base}-${suffix}`;
  }
  return id;
}

/** Same saved or session id; without ids on both sides, the same stream. */
function isSameRadio(snapshot: Radio, radio: Radio): boolean {
  if (snapshot.id !== undefined && radio.id !== undefined) {
    return String(snapshot.id) === String(radio.id);
  }
  return snapshot.streamUrl === radio.streamUrl;
}

/** JSON with sorted keys, so two records compare by content, not key order. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([left], [right]) =>
            left.localeCompare(right)
          )
        )
      : entry
  );
}

/** The Station nodes holding `radio`; a Doppelgänger patch can have two. */
export function findStationNodes(
  graph: Pick<NodeGraph, "nodes">,
  radio: Radio
): StationNode[] {
  return graph.nodes.filter(
    (node): node is StationNode =>
      isStation(node) &&
      node.data.radio !== null &&
      isSameRadio(node.data.radio, radio)
  );
}

/** The first Station node holding `radio`, if the patch has one. */
export function findStationNode(
  graph: Pick<NodeGraph, "nodes">,
  radio: Radio
): StationNode | undefined {
  return findStationNodes(graph, radio)[0];
}

export function wireToSpeakers(graph: NodeGraph, source: string): GraphEdge[] {
  const speakers = graph.nodes.find((node) => node.type === "speakers");
  if (!speakers) {
    return graph.edges;
  }
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));
  return [
    ...graph.edges,
    {
      gain: 1,
      id: uniqueId(`${source}->${speakers.id}`, edgeIds),
      muted: false,
      source,
      sourceHandle: AUDIO_OUT_HANDLE,
      target: speakers.id,
      targetHandle: AUDIO_IN_HANDLE,
    },
  ];
}

/** Below the lowest Station, or one column left of Speakers in a new patch. */
export function nextStationPosition(graph: NodeGraph): Position {
  const stations = graph.nodes.filter(isStation);
  const [first] = stations;
  if (first) {
    return {
      x: first.position.x,
      y:
        Math.max(...stations.map((station) => station.position.y)) +
        STATION_ROW_HEIGHT,
    };
  }
  const speakers = graph.nodes.find((node) => node.type === "speakers");
  return speakers
    ? {
        x: speakers.position.x - FIRST_STATION_OFFSET_X,
        y: speakers.position.y,
      }
    : { x: 0, y: 0 };
}

/**
 * Adds a Station for `radio` wired to Speakers, as the search bar does.
 * A Station already holding `radio` is returned instead of a second one.
 */
export function addStationNode(
  graph: NodeGraph,
  radio: Radio
): { graph: NodeGraph; nodeId: string } {
  const existing = findStationNode(graph, radio);
  if (existing) {
    return { graph, nodeId: existing.id };
  }
  const nodeId = stationNodeId(
    radio,
    new Set(graph.nodes.map((node) => node.id))
  );
  const nodes: GraphNode[] = [
    ...graph.nodes,
    {
      data: { muted: false, radio, volume: 1 },
      id: nodeId,
      position: nextStationPosition(graph),
      type: "station",
    },
  ];
  return {
    graph: { ...graph, edges: wireToSpeakers(graph, nodeId), nodes },
    nodeId,
  };
}

/** Puts `radio` into a Station, e.g. an empty slot picked from its search. */
export function setStationRadio(
  graph: NodeGraph,
  nodeId: string,
  radio: Radio
): NodeGraph {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.id !== nodeId || !isStation(node)) {
      return node;
    }
    changed = true;
    return { ...node, data: { ...node.data, radio } };
  });
  return changed ? { ...graph, nodes } : graph;
}

/**
 * Shows or hides the radio in these Stations, as its saved record does.
 * Only `enabled` changes, so it applies to older snapshots of the patch too.
 */
export function setStationsEnabled(
  graph: NodeGraph,
  nodeIds: Iterable<string>,
  enabled: boolean
): NodeGraph {
  const ids = new Set(nodeIds);
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (
      !(ids.has(node.id) && isStation(node) && node.data.radio) ||
      node.data.radio.enabled === enabled
    ) {
      return node;
    }
    changed = true;
    return {
      ...node,
      data: { ...node.data, radio: { ...node.data.radio, enabled } },
    };
  });
  return changed ? { ...graph, nodes } : graph;
}

/** Removes nodes and every cable touching them. */
export function removeNodes(
  graph: NodeGraph,
  nodeIds: Iterable<string>
): NodeGraph {
  const removed = new Set(nodeIds);
  if (!graph.nodes.some((node) => removed.has(node.id))) {
    return graph;
  }
  return {
    ...graph,
    edges: graph.edges.filter(
      (edge) => !(removed.has(edge.source) || removed.has(edge.target))
    ),
    nodes: graph.nodes.filter((node) => !removed.has(node.id)),
  };
}

export function removeEdges(
  graph: NodeGraph,
  edgeIds: Iterable<string>
): NodeGraph {
  const removed = new Set(edgeIds);
  const edges = graph.edges.filter((edge) => !removed.has(edge.id));
  return edges.length === graph.edges.length ? graph : { ...graph, edges };
}

/** Adds a cable at unity gain. Validation happens before, on drag. */
export function connectNodes(
  graph: NodeGraph,
  { source, sourceHandle, target, targetHandle }: Connection
): NodeGraph {
  if (!(sourceHandle && targetHandle)) {
    return graph;
  }
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));
  return {
    ...graph,
    edges: [
      ...graph.edges,
      {
        gain: 1,
        id: uniqueId(`${source}->${target}`, edgeIds),
        muted: false,
        source,
        sourceHandle,
        target,
        targetHandle,
      },
    ],
  };
}

export function moveNodes(
  graph: NodeGraph,
  positions: ReadonlyMap<string, Position>
): NodeGraph {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    const position = positions.get(node.id);
    if (
      !position ||
      (position.x === node.position.x && position.y === node.position.y)
    ) {
      return node;
    }
    changed = true;
    return { ...node, position: { x: position.x, y: position.y } };
  });
  return changed ? { ...graph, nodes } : graph;
}

/** Where the canvas was panned and zoomed to, restored when it remounts. */
export function setViewport(graph: NodeGraph, viewport: Viewport): NodeGraph {
  const { x, y, zoom } = viewport;
  const current = graph.viewport;
  return current.x === x && current.y === y && current.zoom === zoom
    ? graph
    : { ...graph, viewport: { x, y, zoom } };
}

/**
 * Refreshes each Station's radio snapshot from its live record: an edit, a
 * hide or show, or a session station saved under a new id. `resolve` finds
 * the live record; a Station whose record is gone keeps its snapshot, so the
 * patch still opens.
 */
export function syncStationSnapshots(
  graph: NodeGraph,
  resolve: (radio: Radio) => Radio | undefined
): NodeGraph {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (!isStation(node) || node.data.radio === null) {
      return node;
    }
    const live = resolve(node.data.radio);
    if (!live || stableJson(live) === stableJson(node.data.radio)) {
      return node;
    }
    changed = true;
    return { ...node, data: { ...node.data, radio: live } };
  });
  return changed ? { ...graph, nodes } : graph;
}
