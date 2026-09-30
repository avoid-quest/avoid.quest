/**
 * Graph Edits
 *
 * Pure edits the canvas commits to the node store: cables in and out, nodes
 * moved or removed, FX and native strip params, the viewport, and the
 * Source edits behind search. Filling a Station, Track or File with a radio
 * of another kind turns the node into the one that plays it. The search bar adds
 * a Station wired to Speakers, an empty Station slot is filled in place, and
 * saved-station snapshots follow their records (a rename, a new stream, a
 * hide). Each returns the same graph when nothing changes, so a no-op
 * commits nothing.
 *
 * Cable surgery, Pure Data style: a node dropped on a cable goes into it, a
 * deleted node heals the path it sat on, an FX swaps its type in place, and
 * a selection bypasses or duplicates. A copied cable that would not compile
 * is left out; an insert that would not compile, or a deletion that would
 * disconnect an existing audio path, is refused with the reason.
 */

import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import { UNIVERSAL_EFFECT_PARAM_KEYS } from "@/lib/audio/dsp/effects/universal-params";
import {
  isEffectContainer,
  isEffectContainerType,
} from "@/lib/audio/dsp/routing/effect-tree";
import type { Radio } from "@/lib/audio/playback/types";
import {
  createNodeEffectConfig,
  getNodeDefinition,
  isEffectNodeType,
  portHandleId,
} from "./catalogue";
import { compile, isStationLive } from "./compile";
import {
  type EffectNodeType,
  type GraphEdge,
  type GraphNode,
  isRadioSourceNode,
  MAX_EDGE_GAIN,
  type NodeGraph,
  type TrackSearchPlatform,
} from "./schema";
import { sourceTypeForRadio } from "./sources";
import {
  AUDIO_IN_HANDLE,
  AUDIO_OUT_HANDLE,
  STATION_ROW_HEIGHT,
  stationNodeId,
} from "./templates";
import {
  type Connection,
  connectionVerdict,
  type Issue,
  parseHandleId,
  type ValidateOptions,
} from "./validate";

type StationNode = Extract<GraphNode, { type: "station" }>;
type NativeNode = Extract<GraphNode, { type: "filter" | "pan" | "gain" }>;
type Position = GraphNode["position"];
type Viewport = NodeGraph["viewport"];

/** The data a Filter, Pan or Gain node holds, any of its fields. */
export type NativeParams = Partial<
  Extract<GraphNode, { type: "filter" }>["data"] &
    Extract<GraphNode, { type: "pan" }>["data"] &
    Extract<GraphNode, { type: "gain" }>["data"]
>;

function isNative(node: GraphNode): node is NativeNode {
  return node.type === "filter" || node.type === "pan" || node.type === "gain";
}

/** Shallow: true when every key in `patch` already has that value. */
function holds(data: object, patch: object): boolean {
  return Object.entries(patch).every(
    ([key, value]) => (data as Record<string, unknown>)[key] === value
  );
}

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

/**
 * The rows an empty Track and File take: their bodies are a platform
 * search and a file form, taller than a Station card.
 */
const EMPTY_SOURCE_ROW_HEIGHT = {
  file: 240,
  platform: 320,
  station: STATION_ROW_HEIGHT,
} as const;

function rowHeight(node: GraphNode): number {
  return isRadioSourceNode(node) && node.data.radio === null
    ? EMPTY_SOURCE_ROW_HEIGHT[node.type]
    : STATION_ROW_HEIGHT;
}

/**
 * Below the lowest Station, Track or File, or one column left of Speakers
 * in a new patch.
 */
export function nextStationPosition(graph: NodeGraph): Position {
  const stations = graph.nodes.filter(isRadioSourceNode);
  const [first] = stations;
  if (first) {
    return {
      x: first.position.x,
      y: Math.max(
        ...stations.map((station) => station.position.y + rowHeight(station))
      ),
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
 * The first empty Station slot whose only cables run straight into
 * Speakers, as a new Station from the search would be wired. A slot that
 * also feeds an effect or a key input keeps its role.
 */
function emptySlotOnSpeakers(graph: NodeGraph): StationNode | undefined {
  const speakers = new Set(
    graph.nodes.filter((node) => node.type === "speakers").map((n) => n.id)
  );
  return graph.nodes.find((node): node is StationNode => {
    if (!isStation(node) || node.data.radio !== null) {
      return false;
    }
    const out = graph.edges.filter((edge) => edge.source === node.id);
    return (
      out.length > 0 &&
      out.every(
        (edge) =>
          speakers.has(edge.target) && edge.targetHandle === AUDIO_IN_HANDLE
      )
    );
  });
}

/**
 * Adds a Station for `radio` wired to Speakers, as the search bar does.
 * A Station already holding `radio` is returned instead of a second one,
 * and an empty slot already wired to Speakers (the Starter's) is filled
 * rather than left beside a new Station.
 */
export function addStationNode(
  graph: NodeGraph,
  radio: Radio
): { graph: NodeGraph; nodeId: string } {
  const existing = findStationNode(graph, radio);
  if (existing) {
    return { graph, nodeId: existing.id };
  }
  const slot = emptySlotOnSpeakers(graph);
  if (slot) {
    return { graph: setStationRadio(graph, slot.id, radio), nodeId: slot.id };
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
 * Puts `radio` into a Station, Track or File. A radio of another kind turns
 * the node into the one that plays it, in place: its id, cables, fader and
 * mute stay, so a radio link pasted into a Track becomes a Station.
 */
export function setSourceRadio(
  graph: NodeGraph,
  nodeId: string,
  radio: Radio
): NodeGraph {
  let changed = false;
  const nodes = graph.nodes.map((node): GraphNode => {
    if (node.id !== nodeId || !isRadioSourceNode(node)) {
      return node;
    }
    changed = true;
    const { muted, volume } = node.data;
    return {
      ...node,
      data: { muted, radio, volume },
      type: sourceTypeForRadio(radio),
    };
  });
  return changed ? { ...graph, nodes } : graph;
}

/** Locks an empty Track's search to a platform chip, or unlocks it. */
export function setTrackSearchPlatform(
  graph: NodeGraph,
  nodeId: string,
  searchPlatform: TrackSearchPlatform | undefined
): NodeGraph {
  let changed = false;
  const nodes = graph.nodes.map((node): GraphNode => {
    if (
      node.id !== nodeId ||
      node.type !== "platform" ||
      node.data.searchPlatform === searchPlatform
    ) {
      return node;
    }
    changed = true;
    return { ...node, data: { ...node.data, searchPlatform } };
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

/**
 * What the delete key removes: the selected cables, then the selected nodes
 * with every cable touching them, each healing the path it sat on. A cable
 * deleted on purpose is gone first, so no heal runs through it. Speakers
 * stays, as it can't be deleted. A refused node deletion also keeps the
 * selected cables, so the whole edit is atomic.
 */
export function removeSelection(
  graph: NodeGraph,
  selection: { nodes: readonly string[]; edges: readonly string[] },
  options?: ValidateOptions
): GraphEdit {
  const nodes = selection.nodes.filter(
    (id) => graph.nodes.find((node) => node.id === id)?.type !== "speakers"
  );
  return removeNodesHealed(removeEdges(graph, selection.edges), nodes, options);
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

/**
 * Merges `patch` into an FX node's effect, e.g. a knob turn or its enable
 * switch. The effect id stays the node id, so openDAW updates in place.
 */
export function setEffectParams(
  graph: NodeGraph,
  nodeId: string,
  patch: Partial<EffectConfig>
): NodeGraph {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.id !== nodeId || !isEffectNodeType(node.type)) {
      return node;
    }
    const { effect } = node.data as { effect: EffectConfig };
    if (holds(effect, patch)) {
      return node;
    }
    changed = true;
    return {
      ...node,
      data: {
        effect: { ...effect, ...patch, id: nodeId, type: effect.type },
      },
    } as GraphNode;
  });
  return changed ? { ...graph, nodes } : graph;
}

/**
 * Merges `patch` into a Filter, Pan or Gain node's data. Fields the node
 * doesn't have (a cutoff sent to a Pan) are ignored.
 */
export function setNativeParams(
  graph: NodeGraph,
  nodeId: string,
  patch: NativeParams
): NodeGraph {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.id !== nodeId || !isNative(node)) {
      return node;
    }
    const own = Object.fromEntries(
      Object.entries(patch).filter(([key]) => key in node.data)
    );
    if (holds(node.data, own)) {
      return node;
    }
    changed = true;
    return { ...node, data: { ...node.data, ...own } } as GraphNode;
  });
  return changed ? { ...graph, nodes } : graph;
}

type DeviceInData = Extract<GraphNode, { type: "deviceIn" }>["data"];
type DeviceOutData = Extract<GraphNode, { type: "deviceOut" }>["data"];

/** What an Audio input or Output device body can change. */
export type DeviceParams = Partial<
  Omit<DeviceInData, "muted" | "volume"> & DeviceOutData
>;

/**
 * Merges `patch` into an Audio input's or Output device's data, e.g. the
 * device picked or its channels. Fields the node doesn't have are ignored.
 */
export function setDeviceParams(
  graph: NodeGraph,
  nodeId: string,
  patch: DeviceParams
): NodeGraph {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (
      node.id !== nodeId ||
      !(node.type === "deviceIn" || node.type === "deviceOut")
    ) {
      return node;
    }
    const own = Object.fromEntries(
      Object.entries(patch).filter(([key]) => key in node.data)
    );
    if (holds(node.data, own)) {
      return node;
    }
    changed = true;
    return { ...node, data: { ...node.data, ...own } } as GraphNode;
  });
  return changed ? { ...graph, nodes } : graph;
}

/** An edit that can be refused, with the reason a toast shows. */
export type GraphEdit =
  | { ok: true; graph: NodeGraph }
  | { ok: false; message: string };

function issueKey(issue: Issue): string {
  return `${issue.code}\u0000${issue.target}\u0000${issue.id}`;
}

/**
 * The first problem `after` has that `before` hadn't, as the compiler sees
 * it: the validator's rules plus its own (a Filter only right after the
 * station, branches joined in a Merge). The backend estimate plays no
 * part, so any environment will do.
 */
function newIssue(
  before: NodeGraph,
  after: NodeGraph,
  options?: ValidateOptions
): Issue | undefined {
  const env = { crossOriginIsolated: false, ...options };
  const known = new Set(compile(before, env).issues.map(issueKey));
  return compile(after, env).issues.find(
    (issue) => !known.has(issueKey(issue))
  );
}

/** Adds `cable` if it passes validation and the patch still compiles clean. */
function withCleanCable(
  graph: NodeGraph,
  cable: GraphEdge,
  options?: ValidateOptions
): NodeGraph {
  if (!connectionVerdict(graph, cable, options).ok) {
    return graph;
  }
  const next = { ...graph, edges: [...graph.edges, cable] };
  return newIssue(graph, next, options) ? graph : next;
}

function cableIdsOf(graph: NodeGraph): Set<string> {
  return new Set(graph.edges.map((edge) => edge.id));
}

/** True when no cable touches the node, so it can go into a cable. */
export function isLoose(graph: NodeGraph, nodeId: string): boolean {
  return !graph.edges.some(
    (edge) => edge.source === nodeId || edge.target === nodeId
  );
}

/**
 * Puts a loose node into a cable, A → B becoming A → node → B: dropped on
 * it, or `I` with the cable selected. The cable into the node keeps the old
 * one's id, gain, mute and branch settings, so a branch stays a branch and
 * its level holds; the one out starts at unity. The node's first input and
 * output that fit are used, e.g. a Compressor's main input, not its key.
 */
export function insertNodeOnEdge(
  graph: NodeGraph,
  nodeId: string,
  edgeId: string,
  options?: ValidateOptions
): GraphEdit {
  const edge = graph.edges.find((entry) => entry.id === edgeId);
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  if (!(edge && node)) {
    return { message: "That cable or node is gone", ok: false };
  }
  if (!isLoose(graph, nodeId)) {
    return {
      message: "Only a node with no cables goes into a cable",
      ok: false,
    };
  }
  const { ports } = getNodeDefinition(node.type);
  const index = graph.edges.indexOf(edge);
  const others = graph.edges.filter((entry) => entry !== edge);
  let refusal: string | null = null;
  for (const input of ports.filter((port) => port.direction === "in")) {
    const upstream: GraphEdge = {
      ...edge,
      target: nodeId,
      targetHandle: portHandleId(input),
    };
    const cut = { ...graph, edges: others };
    const up = connectionVerdict(cut, upstream, options);
    if (!up.ok) {
      refusal ??= up.message;
      continue;
    }
    const withUpstream = {
      ...cut,
      edges: graph.edges.map((entry) => (entry === edge ? upstream : entry)),
    };
    for (const output of ports.filter((port) => port.direction === "out")) {
      const downstream: GraphEdge = {
        gain: 1,
        id: uniqueId(`${nodeId}->${edge.target}`, cableIdsOf(graph)),
        muted: false,
        source: nodeId,
        sourceHandle: portHandleId(output),
        target: edge.target,
        targetHandle: edge.targetHandle,
      };
      const down = connectionVerdict(withUpstream, downstream, options);
      if (!down.ok) {
        refusal ??= down.message;
        continue;
      }
      const edges = [...withUpstream.edges];
      edges.splice(index + 1, 0, downstream);
      const inserted = { ...graph, edges };
      // The compiler's reason beats a port's: it is why the fitting pair
      // failed, e.g. a Filter that must sit right after the station.
      const issue = newIssue(graph, inserted, options);
      if (issue) {
        refusal = issue.message;
        continue;
      }
      return { graph: inserted, ok: true };
    }
  }
  return {
    message:
      refusal ??
      `A ${getNodeDefinition(node.type).name} can't go into this cable`,
    ok: false,
  };
}

/**
 * Removes one node and heals the path through it: each cable in joins each
 * cable out when the node's two ports are the same kind, so A → X → B
 * becomes A → B, but a key into X never turns into audio. The healed cable
 * keeps the incoming one's id and branch settings, its gain is both
 * cables' gains, and it is muted if either was. A heal that would not
 * validate or compile is left out.
 */
function removeNodeHealed(
  graph: NodeGraph,
  nodeId: string,
  options?: ValidateOptions
): NodeGraph {
  const ins = graph.edges.filter(
    (edge) => edge.target === nodeId && edge.source !== nodeId
  );
  const outs = graph.edges.filter(
    (edge) => edge.source === nodeId && edge.target !== nodeId
  );
  let next = removeNodes(graph, [nodeId]);
  for (const upstream of ins) {
    for (const downstream of outs) {
      const kind = parseHandleId(upstream.targetHandle)?.kind;
      if (!kind || kind !== parseHandleId(downstream.sourceHandle)?.kind) {
        continue;
      }
      const taken = cableIdsOf(next);
      next = withCleanCable(
        next,
        {
          ...upstream,
          gain: Math.min(upstream.gain * downstream.gain, MAX_EDGE_GAIN),
          id: taken.has(upstream.id)
            ? uniqueId(`${upstream.source}->${downstream.target}`, taken)
            : upstream.id,
          muted: upstream.muted || downstream.muted,
          target: downstream.target,
          targetHandle: downstream.targetHandle,
        },
        options
      );
    }
  }
  return next;
}

/**
 * The patch with every Station playing: an empty or hidden one has no lane,
 * so its routes are compiled as though it did.
 */
function withEveryStationLive(graph: NodeGraph): NodeGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      isStation(node) && !isStationLive(node)
        ? {
            ...node,
            data: {
              ...node.data,
              radio: {
                ...(node.data.radio ?? { name: "", streamUrl: "" }),
                enabled: true,
              },
            },
          }
        : node
    ),
  };
}

/**
 * Removes nodes together, each healing the path through it. Refuses the
 * whole edit if an existing source-to-output route is lost while both ends
 * remain, an empty or hidden Station's included, so it still plays once
 * filled or shown. Explicit cable deletions and removal of a source or
 * output are still allowed; a failed heal must not silently disconnect
 * another lane.
 */
export function removeNodesHealed(
  graph: NodeGraph,
  nodeIds: Iterable<string>,
  options?: ValidateOptions
): GraphEdit {
  let next = graph;
  for (const nodeId of nodeIds) {
    next = removeNodeHealed(next, nodeId, options);
  }
  if (next !== graph) {
    const env = { crossOriginIsolated: false, ...options };
    const remaining = new Set(next.nodes.map((node) => node.id));
    const before = compile(withEveryStationLive(graph), env);
    const after = compile(withEveryStationLive(next), env);
    for (const route of before.edges.values()) {
      if (
        remaining.has(route.from.id) &&
        remaining.has(route.to.id) &&
        ![...after.edges.values()].some(
          (edge) => edge.from.id === route.from.id && edge.to.id === route.to.id
        )
      ) {
        return {
          message:
            "Those nodes can't be removed without disconnecting a source from its output. Remove the cables or the whole branch first.",
          ok: false,
        };
      }
    }
  }
  return { graph: next, ok: true };
}

/** An FX a node can swap to or from: any effect but a split. */
export function isSwappableType(
  type: GraphNode["type"]
): type is EffectNodeType {
  return isEffectNodeType(type) && !isEffectContainerType(type);
}

/**
 * Swaps an FX node to another effect in place. The node keeps its id and
 * position, so MIDI mappings on a param the new effect also has (the
 * universal Mix, In and Out) keep driving it, and every cable stays with
 * its id and handles; only one into a port the new effect lacks (a key
 * into a Delay) goes. The universal wrapper params and the on switch carry
 * over; the rest start at the new effect's defaults.
 */
export function swapEffect(
  graph: NodeGraph,
  nodeId: string,
  type: EffectNodeType
): NodeGraph {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  if (!(node && isSwappableType(node.type) && isSwappableType(type))) {
    return graph;
  }
  if (node.type === type) {
    return graph;
  }
  const previous = (node.data as { effect: EffectConfig }).effect as Record<
    string,
    unknown
  >;
  const carried = Object.fromEntries(
    [...UNIVERSAL_EFFECT_PARAM_KEYS].flatMap((key) =>
      previous[key] === undefined ? [] : [[key, previous[key]]]
    )
  );
  const handles = new Set(getNodeDefinition(type).ports.map(portHandleId));
  const edges = graph.edges.filter(
    (edge) =>
      !(
        (edge.target === nodeId && !handles.has(edge.targetHandle)) ||
        (edge.source === nodeId && !handles.has(edge.sourceHandle))
      )
  );
  const keyed = edges.some(
    (edge) =>
      edge.target === nodeId &&
      parseHandleId(edge.targetHandle)?.kind === "sidechain"
  );
  const effect = {
    ...createNodeEffectConfig(type, nodeId),
    ...carried,
    // A kept key into a Vocoder is its modulator, as when it was cabled.
    ...(type === "vocoder" && keyed ? { modulatorSource: "external" } : {}),
    id: nodeId,
    type,
  } as EffectConfig;
  const nodes = graph.nodes.map((entry) =>
    entry.id === nodeId
      ? ({ ...entry, data: { effect }, type } as GraphNode)
      : entry
  );
  return {
    ...graph,
    edges: edges.length === graph.edges.length ? graph.edges : edges,
    nodes,
  };
}

/**
 * `B`: bypasses the FX among `nodeIds`, or turns them back on when every
 * one is already off. Only their on switch changes, so playback applies it
 * in place without a duck.
 */
export function toggleBypass(
  graph: NodeGraph,
  nodeIds: Iterable<string>
): NodeGraph {
  const ids = new Set(nodeIds);
  const effects = graph.nodes.flatMap((node) =>
    ids.has(node.id) && isEffectNodeType(node.type)
      ? [(node.data as { effect: EffectConfig }).effect]
      : []
  );
  const enabled = effects.every((effect) => !effect.enabled);
  return effects.reduce(
    (next, effect) => setEffectParams(next, effect.id, { enabled }),
    graph
  );
}

/** How far a copy lands from its original, down and right. */
export const DUPLICATE_OFFSET_PX = 40;

/**
 * An FX config under a copy's id. A split's chains (and anything nested in
 * them) are scoped by its id, as `createDefaultEffectConfig` makes them, so
 * a copy in the same lane as its original never shares a chain id with it.
 */
function effectCopy(effect: EffectConfig, from: string, to: string) {
  const scoped = (id: string) =>
    id.startsWith(`${from}:`) ? `${to}${id.slice(from.length)}` : id;
  const visit = (current: EffectConfig, id: string): EffectConfig =>
    isEffectContainer(current)
      ? ({
          ...current,
          chains: current.chains.map((chain) => ({
            ...chain,
            effects: chain.effects.map((child) =>
              visit(child, scoped(child.id))
            ),
            id: scoped(chain.id),
          })),
          id,
        } as EffectConfig)
      : ({ ...current, id } as EffectConfig);
  return visit(effect, to);
}

/**
 * The copies with sound to send on: each makes its own (no audio input,
 * like a Station), or a copied cable into its audio input comes from one
 * that has. A key alone feeds nothing.
 */
function fedCopies(
  originals: readonly GraphNode[],
  inside: readonly GraphEdge[]
): Set<string> {
  const fed = new Set(
    originals.flatMap((node) =>
      getNodeDefinition(node.type).ports.some(
        (port) => port.direction === "in" && port.kind === "audio"
      )
        ? []
        : [node.id]
    )
  );
  const audio = inside.filter(
    (edge) => parseHandleId(edge.targetHandle)?.kind === "audio"
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of audio) {
      if (fed.has(edge.source) && !fed.has(edge.target)) {
        fed.add(edge.target);
        grew = true;
      }
    }
  }
  return fed;
}

/**
 * `Cmd+D`: copies nodes with new ids, offset down and right. Cables between
 * the copied nodes come along, and so does each cable out of a copy that
 * has sound to send, where it still fits: a copied Station comes wired to
 * Speakers like its original (a Doppelgänger), but a copy can't take an
 * FX's only input. A lone FX copy comes loose, so it can be dropped into a
 * cable. Speakers is one per patch and stays. Returns the copies' ids.
 */
export function duplicateNodes(
  graph: NodeGraph,
  nodeIds: Iterable<string>,
  options?: ValidateOptions
): { graph: NodeGraph; nodeIds: string[] } {
  const ids = new Set(nodeIds);
  const originals = graph.nodes.filter(
    (node) => ids.has(node.id) && node.type !== "speakers"
  );
  if (originals.length === 0) {
    return { graph, nodeIds: [] };
  }
  const taken = new Set(graph.nodes.map((node) => node.id));
  const copyOf = new Map<string, string>();
  const copies = originals.map((node): GraphNode => {
    const id =
      isRadioSourceNode(node) && node.data.radio
        ? stationNodeId(node.data.radio as Radio, taken)
        : uniqueId(node.type === "station" ? "src-slot" : node.type, taken);
    taken.add(id);
    copyOf.set(node.id, id);
    const position = {
      x: node.position.x + DUPLICATE_OFFSET_PX,
      y: node.position.y + DUPLICATE_OFFSET_PX,
    };
    if (node.type === "deviceOut") {
      // One Output device a device: the copy picks its own.
      return {
        ...node,
        data: { ...node.data, deviceId: null, deviceLabel: "" },
        id,
        position,
      };
    }
    return isEffectNodeType(node.type)
      ? ({
          ...node,
          data: {
            effect: effectCopy(
              (node.data as { effect: EffectConfig }).effect,
              node.id,
              id
            ),
          },
          id,
          position,
        } as GraphNode)
      : { ...node, id, position };
  });
  const cableIds = cableIdsOf(graph);
  const copyCable = (edge: GraphEdge): GraphEdge => {
    const source = copyOf.get(edge.source) ?? edge.source;
    const target = copyOf.get(edge.target) ?? edge.target;
    const id = uniqueId(`${source}->${target}`, cableIds);
    cableIds.add(id);
    return { ...edge, id, source, target };
  };
  const inside = graph.edges.filter(
    (edge) => copyOf.has(edge.source) && copyOf.has(edge.target)
  );
  const fed = fedCopies(originals, inside);
  const leaving = graph.edges.filter(
    (edge) => fed.has(edge.source) && !copyOf.has(edge.target)
  );
  let next: NodeGraph = {
    ...graph,
    edges: [...graph.edges, ...inside.map(copyCable)],
    nodes: [...graph.nodes, ...copies],
  };
  for (const edge of leaving) {
    next = withCleanCable(next, copyCable(edge), options);
  }
  return { graph: next, nodeIds: [...copyOf.values()] };
}
