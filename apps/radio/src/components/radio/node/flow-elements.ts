/**
 * Flow Elements
 *
 * The patch as React Flow's controlled nodes and edges, with the names a
 * screen reader hears: each node is an "audio module", each cable reads
 * like "KEXP audio to Speakers input". Types only from the adapter, so this
 * stays testable without the canvas chunk.
 */

import {
  branchBaseGain,
  branchBaseMuted,
  branchBasePan,
  branchName,
  branchTag,
  isSplitNode,
} from "@/lib/node-graph/branches";
import { getNodeDefinition, isShipped } from "@/lib/node-graph/catalogue";
import {
  type EnginePlan,
  laneChannelId,
  type MergeRole,
} from "@/lib/node-graph/compile";
import { edgeLabel, nodeLabel } from "@/lib/node-graph/describe";
import { MODULATION_NODE_TYPES } from "@/lib/node-graph/modulation-schema";
import type { NodeSelection } from "@/lib/node-graph/node-store";
import {
  EFFECT_NODE_TYPES,
  type GraphEdge,
  type GraphNode,
  isRadioSourceNode,
  NATIVE_NODE_TYPES,
  type NodeGraph,
  type NodeType,
} from "@/lib/node-graph/schema";
import { parseHandleId } from "@/lib/node-graph/validate";
import type { FlowAriaLabelConfig, FlowEdge, FlowNode } from "./flow-adapter";

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/**
 * The node types the canvas draws today: Station, Track, File and Audio input,
 * Speakers and Output device, the native strip, every shipped effect (all
 * but Werkstatt) with the splits, and the Merge that closes them.
 */
export const DRAWN_NODE_TYPES: readonly NodeType[] = [
  ...MODULATION_NODE_TYPES,
  "speakers",
  "deviceOut",
  "station",
  "platform",
  "file",
  "deviceIn",
  "merge",
  ...NATIVE_NODE_TYPES,
  ...EFFECT_NODE_TYPES.filter((type) =>
    isShipped(getNodeDefinition(type).ship, "v1")
  ),
];

export function isDrawn(node: GraphNode): boolean {
  return DRAWN_NODE_TYPES.includes(node.type);
}

/**
 * React Flow's announcements in the app's words. React Flow reads the
 * `keyboardDisabled` description while keyboard access is on (its own
 * default there names the arrow keys) and `default` only once it is off,
 * so the arrow keys belong in the first. B only bypasses an effect.
 */
export const NODE_ARIA_LABELS: Partial<FlowAriaLabelConfig> = {
  "edge.a11yDescription.default":
    "Press Enter or Space to select this cable, then I to insert a node into it or Delete to remove it.",
  "handle.ariaLabel": "Port",
  "node.a11yDescription.ariaLiveMessage": ({ direction, x, y }) =>
    `Moved the module ${direction} to ${Math.round(x)}, ${Math.round(y)}`,
  "node.a11yDescription.default":
    "Press Enter or Space to select this module, C to connect it, B to bypass an effect, Delete to remove it and Escape to cancel.",
  "node.a11yDescription.keyboardDisabled":
    "Press Enter or Space to select this module, then the arrow keys to move it. C connects it, B bypasses an effect, Delete removes it and Escape cancels.",
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

/**
 * The port a cable from `from` was let go or tapped on, when it faces the
 * cable: an input for a cable leaving an output, and the reverse. A port on
 * the cable's own side counts as its node's body, so the drop still takes
 * the node's one fitting port.
 */
export function facingPort(
  portElement: Element | null | undefined,
  from: { type: "source" | "target" }
): { handle: string | null; node: string | null } {
  const facing = from.type === "source" ? "target" : "source";
  return portElement?.classList.contains(facing)
    ? {
        handle: portElement.getAttribute("data-handleid"),
        node: portElement.getAttribute("data-nodeid"),
      }
    : { handle: null, node: null };
}

/**
 * The cable under a point, e.g. under a node being dragged: every element
 * there is checked, so the node on top doesn't hide the cable below it.
 */
export function edgeUnderPointer(
  pointer: Point,
  doc: Pick<Document, "elementsFromPoint"> | undefined = globalThis.document
): string | null {
  // JSDOM and old engines have no elementsFromPoint.
  const below = doc?.elementsFromPoint?.(pointer.x, pointer.y) ?? [];
  for (const element of below) {
    const id = element.closest(".react-flow__edge")?.getAttribute("data-id");
    if (id) {
      return id;
    }
  }
  return null;
}

/**
 * Whether `nodeId`'s audio reaches an output (Speakers or an Output
 * device) along its audio cables: an Audio input that does can howl.
 */
export function feedsOutput(
  graph: Pick<NodeGraph, "nodes" | "edges">,
  nodeId: string
): boolean {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const queue = [nodeId];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    for (const edge of graph.edges) {
      if (
        edge.source !== id ||
        edge.muted ||
        parseHandleId(edge.targetHandle)?.kind !== "audio"
      ) {
        continue;
      }
      const target = byId.get(edge.target);
      if (target && getNodeDefinition(target.type).category === "output") {
        return true;
      }
      queue.push(edge.target);
    }
  }
  return false;
}

/**
 * An Audio input's feedback guard for a Stage or Rack row: set while its
 * audio reaches an output, null otherwise or for any other node.
 */
export function inputFeedback(
  graph: Pick<NodeGraph, "nodes" | "edges"> | null,
  nodeId: string
): { echoCancellation: boolean } | null {
  const node = graph?.nodes.find((entry) => entry.id === nodeId);
  return graph && node?.type === "deviceIn" && feedsOutput(graph, nodeId)
    ? { echoCancellation: node.data.echoCancellation }
    : null;
}

/** What an Audio input draws: its data, and whether it can howl. */
export type AudioInputNodeData = Extract<
  GraphNode,
  { type: "deviceIn" }
>["data"] & { feedsOutput: boolean };

/** What an Output device draws: its own device and mute. */
export type OutputDeviceNodeData = Extract<
  GraphNode,
  { type: "deviceOut" }
>["data"];

/** What a Merge node draws: its compiler badge and how many cables it joins. */
export type MergeNodeData = { role: MergeRole | null; inputs: number };

/** What a branch cable draws: its tag, and the chain params it carries. */
export type BranchEdgeData = {
  baseGain: number;
  /** The chain's own pan, which the cable's `pan` is added to. */
  basePan: number;
  tag: string;
  name: string;
  gain: number;
  muted: boolean;
  pan: number;
  solo: boolean;
};

/** What a key cable draws: why it keys nothing, or null while it keys. */
export type KeyEdgeData = { idle: string | null };

/**
 * The flow element last drawn for each patch node and cable. React Flow
 * rebuilds and re-renders every node and cable handed to it as a new
 * object, so one that comes out the same as last time is handed back as
 * it was: a knob tick or a drag move then re-renders only what it changed.
 */
const drawnNodes = new WeakMap<GraphNode, FlowNode>();
const drawnEdges = new WeakMap<GraphEdge, FlowEdge>();

/** `next`, or the element last drawn for `key` when it is the same. */
function reuseDrawn<K extends object, V>(
  drawn: WeakMap<K, V>,
  key: K,
  next: V
): V {
  const previous = drawn.get(key);
  if (previous !== undefined && sameDrawn(previous, next)) {
    return previous;
  }
  drawn.set(key, next);
  return next;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === Array.prototype;
}

/** Equal values: plain objects and arrays by their entries, else identity. */
function sameDrawn(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (!(isPlain(a) && isPlain(b)) || Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameDrawn(a[key], b[key]))
  );
}

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
  const dataOf = (node: GraphNode) => {
    if (node.type === "merge") {
      return mergeData(graph, node, mergeRoles);
    }
    if (node.type === "deviceIn") {
      const data: AudioInputNodeData = {
        ...node.data,
        feedsOutput: feedsOutput(graph, node.id),
      };
      return data;
    }
    return node.data;
  };
  return graph.nodes.filter(isDrawn).map((node) =>
    reuseDrawn(drawnNodes, node, {
      // Named like its cables, so "KEXP, audio module" rather than a bare role.
      ariaLabel: nodeLabel(node),
      data: dataOf(node),
      deletable: node.type !== "speakers",
      domAttributes: { "aria-roledescription": "audio module" },
      id: node.id,
      measured: measured.get(node.id),
      position: positions.get(node.id) ?? node.position,
      selected: selection.nodes.includes(node.id),
      type: node.type,
    })
  );
}

/** Nothing a solo silences: a patch with no plan yet. */
const NO_SOLO: SoloedOut = { branches: new Set(), sources: new Set() };

type SoloedOut = EnginePlan["soloedOut"];

/**
 * A cable that plays nothing: muted, or turned all the way down, itself
 * or, out of a split, the chain under it, as the compiler multiplies them;
 * or a branch the split's solo leaves out.
 */
function isSilent(
  edge: GraphEdge,
  source: GraphNode | undefined,
  soloedOut: SoloedOut
): boolean {
  if (edge.muted || edge.gain === 0 || soloedOut.branches.has(edge.id)) {
    return true;
  }
  return (
    isSplitNode(source) &&
    (branchBaseMuted(source, edge.sourceHandle) ||
      branchBaseGain(source, edge.sourceHandle) === 0)
  );
}

/**
 * Nodes carrying a playing source's audio on air: each live Station, Track,
 * File or Audio input no other source's solo mutes, and every node its
 * audible audio cables reach through FX, up to the outputs.
 */
export function liveNodeIds(
  graph: Pick<NodeGraph, "nodes" | "edges">,
  liveLanes: ReadonlySet<string>,
  soloedOut: SoloedOut = NO_SOLO
): Set<string> {
  const live = new Set<string>();
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const queue = graph.nodes
    .filter(
      (node) =>
        (isRadioSourceNode(node) || node.type === "deviceIn") &&
        liveLanes.has(laneChannelId(node.id)) &&
        !soloedOut.sources.has(node.id)
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
        !isSilent(edge, byId.get(id), soloedOut) &&
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
    baseGain: branchBaseGain(source, edge.sourceHandle),
    basePan: branchBasePan(source, edge.sourceHandle),
    gain: edge.gain,
    muted: edge.muted,
    name: branchName(source, edge.sourceHandle),
    pan: edge.pan ?? 0,
    solo: edge.solo === true,
    tag: branchTag(source, edge.sourceHandle),
  };
  return { data, type: "branch" };
}

/**
 * A key cable draws in the Key amber, long-dashed, and says when it keys
 * nothing and why. It carries its point's audio to a detector, not on
 * air, so it never glows Live; audio reaching it only thickens it. A
 * playing station's does, soloed out or not, as the engine taps the raw
 * lane.
 */
function keyOf(
  edge: GraphEdge,
  label: string,
  {
    live,
    liveLanes,
  }: { live: ReadonlySet<string>; liveLanes: ReadonlySet<string> },
  idleKeys: ReadonlyMap<string, string>
): Pick<FlowEdge, "ariaLabel" | "className" | "data" | "type"> {
  const idle = idleKeys.get(edge.id) ?? null;
  const data: KeyEdgeData = { idle };
  let className = "node-edge-key";
  if (idle) {
    className += " node-edge-key-idle";
  } else if (
    live.has(edge.source) ||
    liveLanes.has(laneChannelId(edge.source))
  ) {
    className += " node-edge-key-live";
  }
  return {
    ariaLabel: idle ? `${label}, not keying: ${idle}` : label,
    className,
    data,
    type: "key",
  };
}

export function toFlowEdges(
  graph: NodeGraph,
  {
    selection,
    liveLanes,
    idleKeys = new Map(),
    soloedOut = NO_SOLO,
    insertTarget = null,
  }: {
    selection: NodeSelection;
    /** Channel ids of the lanes playing now. */
    liveLanes: ReadonlySet<string>;
    /** Key cables that key nothing, with why (`idleKeys` in compile). */
    idleKeys?: ReadonlyMap<string, string>;
    /** What a solo silences (`soloedOut` in the compiled plan). */
    soloedOut?: SoloedOut;
    /** The cable a dragged node would go into if let go now. */
    insertTarget?: string | null;
  }
): FlowEdge[] {
  const drawn = new Map(
    graph.nodes.filter(isDrawn).map((node) => [node.id, node])
  );
  const live = liveNodeIds(graph, liveLanes, soloedOut);
  return graph.edges
    .filter((edge) => drawn.has(edge.source) && drawn.has(edge.target))
    .map((edge) => {
      const kind = parseHandleId(edge.targetHandle)?.kind;
      const label = edgeLabel(graph, edge);
      const flowEdge: FlowEdge = {
        ...branchOf(drawn.get(edge.source), edge),
        ariaLabel: label,
        className:
          live.has(edge.source) &&
          kind === "audio" &&
          !isSilent(edge, drawn.get(edge.source), soloedOut)
            ? "node-edge-live"
            : undefined,
        ...(kind === "sidechain"
          ? keyOf(edge, label, { live, liveLanes }, idleKeys)
          : undefined),
        ...(kind === "control"
          ? { className: "node-edge-control", type: "control" }
          : undefined),
        domAttributes: { "aria-roledescription": "cable" },
        id: edge.id,
        selected: selection.edges.includes(edge.id),
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: edge.target,
        targetHandle: edge.targetHandle,
      };
      if (edge.id === insertTarget) {
        flowEdge.className =
          `${flowEdge.className ?? ""} node-edge-insert`.trim();
      }
      return reuseDrawn(drawnEdges, edge, flowEdge);
    });
}
