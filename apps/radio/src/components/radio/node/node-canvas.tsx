/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { compiledPlan } from "@/lib/node-graph/compiled-plan";
import "@/styles/node-mode.css";
import { useStore } from "@tanstack/react-store";
import { type RefObject, useEffect, useRef, useState } from "react";
import { type ExternalToast, toast } from "sonner";
import { isEffectContainerType } from "@/lib/audio/dsp/routing/effect-tree";
import { isEffectNodeType } from "@/lib/node-graph/catalogue";
import { idleKeys, mergeRoles } from "@/lib/node-graph/compile";
import {
  connectNodes,
  insertNodeOnEdge,
  isLoose,
  moveNodes,
  reconnectEdge,
  removeEdges,
  removeNodesHealed,
  setViewport as setGraphViewport,
} from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  nodeStore,
  setNodeSelection,
  useNodeGraph,
  useNodeSelection,
} from "@/lib/node-graph/node-store";
import {
  dropOnNode,
  type PaletteFrom,
  paletteEntries,
  type Replacement,
} from "@/lib/node-graph/palette";
import type { GraphEdge, NodeGraph } from "@/lib/node-graph/schema";
import {
  parallelToSeries,
  seriesToParallel,
} from "@/lib/node-graph/series-parallel";
import { STATION_ROW_HEIGHT } from "@/lib/node-graph/templates";
import type { Connection, ValidateOptions } from "@/lib/node-graph/validate";
import { detectNodePlaybackEnv } from "@/lib/node-playback";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";
import { AudioInputNode } from "./audio-input-node";
import { BranchEdge } from "./branch-edge";
import { useCableSurgeryShortcuts } from "./cable-surgery";
import {
  canConnect,
  clearConnectionHints,
  startConnectionHints,
} from "./connection-hints";
import { EffectNode } from "./effect-node";
import { FileNode } from "./file-node";
import {
  ConnectionMode,
  type FlowConnection,
  type FlowConnectionEnd,
  type FlowConnectStart,
  type FlowEdge,
  type FlowEdgeChange,
  type FlowEdgeTypes,
  type FlowNodeChange,
  type FlowNodeTypes,
  type FlowRect,
  type FlowViewport,
  getViewportForBounds,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
} from "./flow-adapter";
import {
  DRAWN_NODE_TYPES,
  dropTargetOf,
  edgeUnderPointer,
  facingPort,
  NODE_ARIA_LABELS,
  pointerOf,
  toFlowEdges,
  toFlowNodes,
} from "./flow-elements";
import { KeyEdge } from "./key-edge";
import { MergeNode } from "./merge-node";
import { NativeStripNode } from "./native-strip-nodes";
import {
  isCanvasKey,
  isShortcutIgnored,
  type PaletteRequest,
} from "./node-palette";
import { FlowPortsRoot } from "./node-port";
import { OutputDeviceNode } from "./output-device-node";
import { SpeakersNode } from "./speakers-node";
import { SplitNode } from "./split-nodes";
import { StationNode } from "./station-node";
import { TrackNode } from "./track-node";

type Point = { x: number; y: number };
type Size = { width: number; height: number };

const nodeTypes = {
  // Every drawn effect shares one node, and every split another; sources
  // and outputs come last.
  ...Object.fromEntries(
    DRAWN_NODE_TYPES.filter(isEffectNodeType).map((type) => [
      type,
      isEffectContainerType(type) ? SplitNode : EffectNode,
    ])
  ),
  deviceIn: AudioInputNode,
  deviceOut: OutputDeviceNode,
  file: FileNode,
  filter: NativeStripNode,
  gain: NativeStripNode,
  merge: MergeNode,
  pan: NativeStripNode,
  platform: TrackNode,
  speakers: SpeakersNode,
  station: StationNode,
} satisfies FlowNodeTypes;

/**
 * A cable out of a split draws as a branch, with its tag and controls; a
 * cable into a sidechain as a key, amber and long-dashed.
 */
const edgeTypes = {
  branch: BranchEdge,
  key: KeyEdge,
} satisfies FlowEdgeTypes;

/** P and S: series ⇄ parallel on the selected FX. */
const SERIES_PARALLEL_EDITS = {
  p: seriesToParallel,
  s: parallelToSeries,
} as const;

/** Station node width, so a node fed from an input lands with its port at the cursor. */
const STATION_WIDTH = 240;
const FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.2 };
/**
 * On a phone the fit stops at a zoom where text reads and ports take a
 * tap, and the patch pans instead of shrinking past it.
 */
const PHONE_FIT_VIEW_OPTIONS = { ...FIT_VIEW_OPTIONS, minZoom: 0.6 };
/** The gap a phone fit leaves above (or left of) a patch too big to fit. */
const PHONE_FIT_MARGIN = 16;
/** The canvas hint's strip along the bottom, kept clear by a reveal. */
const HINT_CLEARANCE = 32;
/** Frames a reveal waits for a new node's measured size. */
const REVEAL_MEASURE_FRAMES = 10;
/**
 * Where a phone fit leaves the view: the fit's own, except that a patch
 * still too tall (or too wide) at the readable zoom shows its top (or left)
 * edge, where Speakers and the first sources are, rather than its middle.
 */
export function phoneFitViewport(
  box: FlowRect,
  width: number,
  height: number
): FlowViewport {
  const { maxZoom, minZoom, padding } = PHONE_FIT_VIEW_OPTIONS;
  const fit = getViewportForBounds(
    box,
    width,
    height,
    minZoom,
    maxZoom,
    padding
  );
  const overflows = (size: number, room: number) =>
    size * fit.zoom > room - 2 * PHONE_FIT_MARGIN;
  return {
    x: overflows(box.width, width)
      ? PHONE_FIT_MARGIN - box.x * fit.zoom
      : fit.x,
    y: overflows(box.height, height)
      ? PHONE_FIT_MARGIN - box.y * fit.zoom
      : fit.y,
    zoom: fit.zoom,
  };
}

type FitTools = Pick<
  ReturnType<typeof useReactFlow>,
  "fitView" | "getNodes" | "getNodesBounds" | "setViewport"
>;

/** Whether any node shows in `wrapper` at `viewport`. */
function anyNodeInView(
  { getNodes, getNodesBounds }: FitTools,
  wrapper: HTMLElement | null,
  { x, y, zoom }: FlowViewport
): boolean {
  const frame = wrapper?.getBoundingClientRect();
  if (!frame) {
    return true;
  }
  return getNodes().some((node) => {
    const box = getNodesBounds([node]);
    const left = x + box.x * zoom;
    const top = y + box.y * zoom;
    return (
      left < frame.width &&
      top < frame.height &&
      left + box.width * zoom > 0 &&
      top + box.height * zoom > 0
    );
  });
}

/**
 * Fits the patch in view, as F, a template load or a second tap on Patch
 * does; on a phone a patch too big for the readable zoom shows its top.
 */
function fitPatch(
  { fitView, getNodes, getNodesBounds, setViewport }: FitTools,
  wrapper: HTMLElement | null,
  isPhone: boolean,
  duration?: number
): void {
  const frame = wrapper?.getBoundingClientRect();
  const nodes = getNodes();
  if (!(isPhone && frame && nodes.length > 0)) {
    fitView({
      ...(isPhone ? PHONE_FIT_VIEW_OPTIONS : FIT_VIEW_OPTIONS),
      duration,
    });
    return;
  }
  setViewport(
    phoneFitViewport(getNodesBounds(nodes), frame.width, frame.height),
    { duration }
  );
}

/**
 * Arrow-key nudges of a selected node less than this far apart are one undo
 * step: a held arrow repeats about 30 times a second, and a step per nudge
 * would push the whole undo history out.
 */
export const NUDGE_SETTLE_MS = 300;

/** No React Flow attribution in the canvas corner. */
const PRO_OPTIONS = { hideAttribution: true };

/** A loose node dragged over a cable it can go into. */
type InsertTarget = { node: string; edge: string };

/**
 * Whether two insert aims are the same. Plain checks rather than optional
 * chaining: the React Compiler bails out of the whole Canvas on an
 * optional-chained comparison inside a ternary test.
 */
function sameInsertTarget(
  a: InsertTarget | null,
  b: InsertTarget | null
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.edge === b.edge && a.node === b.node;
}

/** The playing channel ids, sorted and space-joined for a cheap compare. */
function liveChannelKey(
  channels: Record<string, { isPlaying: boolean }>
): string {
  return Object.keys(channels)
    .filter((channelId) => channels[channelId]?.isPlaying)
    .sort()
    .join(" ");
}

/** A patch never panned or zoomed still has the template's viewport. */
function isUntouchedViewport({ x, y, zoom }: FlowViewport): boolean {
  return x === 0 && y === 0 && zoom === 1;
}

/**
 * An untouched patch opens fitted, and so does one whose saved view shows
 * none of it on a phone, e.g. a view saved on a wider screen.
 */
function needsFit(
  tools: FitTools,
  wrapper: HTMLElement | null,
  isPhone: boolean,
  viewport: FlowViewport
): boolean {
  return (
    isUntouchedViewport(viewport) ||
    (isPhone && !anyNodeInView(tools, wrapper, viewport))
  );
}

function sameViewport(left: FlowViewport, right: FlowViewport): boolean {
  return left.x === right.x && left.y === right.y && left.zoom === right.zoom;
}

/** React Flow's node changes, folded into what the canvas keeps or commits. */
type NodeChangeBatch = {
  /** Positions mid-drag, shown but not yet committed. */
  dragging: Map<string, Point>;
  /** Positions where a drag stopped, committed to the patch. */
  dropped: Map<string, Point>;
  removed: string[];
  selected: Set<string>;
  sizes: Map<string, Size>;
};

/** A refused React Flow removal keeps the controlled graph and selection. */
function removeCanvasNodes(
  nodeIds: string[],
  options: ValidateOptions
): boolean {
  if (nodeIds.length === 0) {
    return true;
  }
  const { graph } = nodeStore.state;
  if (!graph) {
    return false;
  }
  const edit = removeNodesHealed(graph, nodeIds, options);
  if (!edit.ok) {
    toast(edit.message);
    return false;
  }
  commitNodeGraph(() => edit.graph, nodeStore, "snapshot");
  return true;
}

/**
 * Takes the positions React Flow let go of without having dragged them out
 * of `batch.dropped` and returns them: arrow-key nudges, not drops.
 * `draggingIds` tracks the nodes mid-drag across batches.
 */
function takeNudges(
  batch: NodeChangeBatch,
  draggingIds: Set<string>
): Map<string, Point> {
  const nudged = new Map<string, Point>();
  for (const id of batch.dragging.keys()) {
    draggingIds.add(id);
  }
  for (const [id, position] of batch.dropped) {
    if (!draggingIds.delete(id)) {
      nudged.set(id, position);
      batch.dropped.delete(id);
    }
  }
  return nudged;
}

/** The last arrow-key nudge: the patch it left, and when. */
type NudgeRun = { graph: NodeGraph; at: number };

/**
 * Moves nudged nodes, if any. A nudge is an undo step at once, so no later
 * edit (a knob dragged right after) can fold into it. The next nudge of a
 * run joins that step while nothing else has been committed since.
 */
function nudgeNodes(
  nudged: ReadonlyMap<string, Point>,
  run: RefObject<NudgeRun | null>
): void {
  if (nudged.size === 0) {
    return;
  }
  const at = performance.now();
  const last = run.current;
  const continues =
    last !== null &&
    at - last.at < NUDGE_SETTLE_MS &&
    nodeStore.state.graph === last.graph;
  commitNodeGraph(
    (latest) => moveNodes(latest, nudged),
    nodeStore,
    continues ? "amend" : "snapshot"
  );
  const { graph } = nodeStore.state;
  run.current = graph ? { at, graph } : null;
}

function foldNodeChange(batch: NodeChangeBatch, change: FlowNodeChange) {
  switch (change.type) {
    case "position":
      if (!change.position) {
        return;
      }
      if (change.dragging) {
        batch.dragging.set(change.id, change.position);
        return;
      }
      batch.dragging.delete(change.id);
      batch.dropped.set(change.id, change.position);
      return;
    case "dimensions":
      if (change.dimensions) {
        batch.sizes.set(change.id, change.dimensions);
      }
      return;
    case "select":
      if (change.selected) {
        batch.selected.add(change.id);
      } else {
        batch.selected.delete(change.id);
      }
      return;
    case "remove":
      batch.removed.push(change.id);
      return;
    default:
      return;
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

/** Cable `cable.id` still runs between the ends it had. */
function unmoved(graph: NodeGraph, cable: GraphEdge): boolean {
  const now = graph.edges.find((entry) => entry.id === cable.id);
  return (
    now !== undefined &&
    now.source === cable.source &&
    now.sourceHandle === cable.sourceHandle &&
    now.target === cable.target &&
    now.targetHandle === cable.targetHandle
  );
}

/** Cable `edgeId` is still on the port a Replace was offered for. */
function holdsPort(
  graph: NodeGraph,
  edgeId: string,
  fromType: PaletteFrom["type"],
  connection: Connection
): boolean {
  const held = graph.edges.find((entry) => entry.id === edgeId);
  if (!held) {
    return false;
  }
  return fromType === "source"
    ? held.target === connection.target &&
        held.targetHandle === connection.targetHandle
    : held.source === connection.source &&
        held.sourceHandle === connection.sourceHandle;
}

/** A node picked for a cable let go in space, to move level with the drop. */
export type PortDrop = { nodeId: string; from: PaletteFrom; y: number };

/**
 * The port on `nodeId` that the cable from `from` plugs into, as React
 * Flow measured it: its handle, and which side's handles it is among.
 */
function droppedPort(
  graph: NodeGraph | null,
  { from, nodeId }: PortDrop
): { handle: string; side: "source" | "target" } | null {
  const fromSource = from.type === "source";
  const cable = graph?.edges.find((edge) =>
    fromSource
      ? edge.source === from.node &&
        edge.sourceHandle === from.handle &&
        edge.target === nodeId
      : edge.target === from.node &&
        edge.targetHandle === from.handle &&
        edge.source === nodeId
  );
  if (!cable) {
    return null;
  }
  return fromSource
    ? { handle: cable.targetHandle, side: "target" }
    : { handle: cable.sourceHandle, side: "source" };
}

export type NodeCanvasProps = {
  /** A Station the search bar just added; the view pans to it if hidden. */
  reveal: { nodeId: string } | null;
  /**
   * Bumped to fit the patch in view, e.g. after a template loads. A
   * request is fitted once, then handed back through `onFitHandled`, so a
   * canvas mounted again (a phone back on Patch) keeps its pan and zoom.
   */
  fitRequest: number;
  onFitHandled?: () => void;
  /** A node picked for a cable let go in space; handed back once level. */
  portDrop?: PortDrop | null;
  onPortDropHandled?: () => void;
  /** Opens the add-node palette: double-click, or a cable dropped in space. */
  onOpenPalette: (request: PaletteRequest) => void;
  /** C on a focused node opens the keyboard Connect… dialog for it. */
  onOpenConnect: (nodeId: string) => void;
  /** A phone fits the patch no smaller than a readable zoom. */
  isPhone?: boolean;
};

function Canvas({
  graph,
  reveal,
  fitRequest,
  onFitHandled,
  portDrop = null,
  onPortDropHandled,
  onOpenPalette,
  onOpenConnect,
  isPhone = false,
}: NodeCanvasProps & { graph: NodeGraph }) {
  const fitViewOptions = isPhone ? PHONE_FIT_VIEW_OPTIONS : FIT_VIEW_OPTIONS;
  const selection = useNodeSelection();
  // Only which lanes play, as a string: a buffering flag or an error on one
  // Station must not re-render every cable.
  const liveLanes = new Set(
    useStore(playbackRuntimeStore, (state) =>
      liveChannelKey(state.channels)
    ).split(" ")
  );
  const [dragPositions, setDragPositions] = useState<
    ReadonlyMap<string, Point>
  >(new Map());
  const [measured, setMeasured] = useState<ReadonlyMap<string, Size>>(
    new Map()
  );
  // Read once: React Flow takes its starting viewport only on mount.
  const [initialViewport] = useState(() => graph.viewport);
  // The view the canvas opened on or last settled on. The patch's own
  // viewport differing from it was set elsewhere, e.g. by an import.
  const viewRef = useRef<FlowViewport>(initialViewport);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // The nodes React Flow is dragging. A node it lets go of without having
  // dragged it was nudged with the arrow keys.
  const draggingRef = useRef<Set<string>>(new Set());
  const nudgeRunRef = useRef<NudgeRun | null>(null);
  // The cable a dragged node would go into if let go now: state to
  // highlight it, a ref for the drop, which reads it in the same event.
  const [insertTarget, setInsertTarget] = useState<InsertTarget | null>(null);
  const insertTargetRef = useRef<InsertTarget | null>(null);
  const probedRef = useRef<{ node: string; edge: string | null } | null>(null);
  const insertionCanceledRef = useRef<boolean>(false);
  // A cable end being dragged to rewire it: the cable, and the patch
  // without it, which that drag's verdicts and drop are taken on.
  const rewireRef = useRef<{ edge: string; graph: NodeGraph } | null>(null);
  const rewiring = (): { edge: string; graph: NodeGraph } | null =>
    rewireRef.current;
  const dragGraph = () => rewiring()?.graph ?? graph;
  const fitTools = useReactFlow();
  const {
    flowToScreenPosition,
    getInternalNode,
    getZoom,
    screenToFlowPosition,
    setCenter,
  } = fitTools;
  const nodesInitialized = useNodesInitialized();
  const phoneAlignedRef = useRef(false);
  const [env] = useState(detectNodePlaybackEnv);
  const validateOptions = { profile: env.profile };
  // The compiler's verdict on each Merge, for its in-lane badge, and on
  // each key cable, for its idle tag.
  const plan = compiledPlan(graph, env);
  const roles = mergeRoles(graph, plan);

  const nodes = toFlowNodes(graph, {
    measured,
    mergeRoles: roles,
    positions: dragPositions,
    selection,
  });
  const edges = toFlowEdges(graph, {
    idleKeys: idleKeys(graph, plan),
    insertTarget: insertTarget?.edge ?? null,
    liveLanes,
    selection,
  });

  const aimInsert = (target: InsertTarget | null) => {
    insertTargetRef.current = target;
    setInsertTarget((previous) =>
      sameInsertTarget(previous, target) ? previous : target
    );
  };

  const cancelInsertion = () => {
    insertionCanceledRef.current = true;
    probedRef.current = null;
    aimInsert(null);
  };

  const startInsertion = () => {
    insertionCanceledRef.current = false;
    probedRef.current = null;
    aimInsert(null);
  };

  // React Flow aborts a multi-touch drag without calling onNodeDragStop,
  // but still emits its final position changes. Cancel before those arrive.
  const handleTouchMoveCapture = (event: React.TouchEvent) => {
    if (event.touches.length > 1) {
      cancelInsertion();
    }
  };

  const handleTouchStartCapture = (event: React.TouchEvent) => {
    if (event.touches.length === 1) {
      startInsertion();
    } else {
      cancelInsertion();
    }
  };

  const handleLostPointerCapture = (event: React.PointerEvent) => {
    // Touch implicitly releases capture after pointerup, before touchend.
    // That normal release must still allow React Flow to commit the drop.
    if (event.buttons > 0) {
      cancelInsertion();
    }
  };

  // React Flow can call onNodesChange and onEdgesChange back to back in one
  // event (select a node, deselect a cable), so each handler reads the
  // current selection and state instead of this render's copy.
  const handleNodesChange = (changes: FlowNodeChange[]) => {
    const current = nodeStore.state.selection;
    const batch: NodeChangeBatch = {
      dragging: new Map(),
      dropped: new Map(),
      removed: [],
      selected: new Set(current.nodes),
      sizes: new Map(),
    };
    for (const change of changes) {
      foldNodeChange(batch, change);
    }
    const { dragging, dropped, removed, selected, sizes } = batch;
    const nudged = takeNudges(batch, draggingRef.current);
    if (dragging.size > 0 || dropped.size > 0) {
      setDragPositions((previous) => {
        const next = new Map(previous);
        for (const id of dropped.keys()) {
          next.delete(id);
        }
        for (const [id, position] of dragging) {
          next.set(id, position);
        }
        return next;
      });
    }
    if (sizes.size > 0) {
      setMeasured((previous) => new Map([...previous, ...sizes]));
    }
    // Positions persist on drag stop, not on every pointer move, and each
    // drag is one undo step. Let go over a cable, the node goes into it in
    // that same step.
    if (dropped.size > 0) {
      const aimed: InsertTarget | null = insertTargetRef.current;
      const insert =
        !insertionCanceledRef.current && aimed && dropped.has(aimed.node)
          ? aimed
          : null;
      if (insert) {
        aimInsert(null);
        probedRef.current = null;
      }
      commitNodeGraph(
        (latest) => {
          const moved = moveNodes(latest, dropped);
          const edit =
            insert &&
            insertNodeOnEdge(moved, insert.node, insert.edge, validateOptions);
          return edit?.ok ? edit.graph : moved;
        },
        nodeStore,
        "snapshot"
      );
    }
    nudgeNodes(nudged, nudgeRunRef);
    const removalAccepted = removeCanvasNodes(removed, validateOptions);
    const selectedNodes = (
      removalAccepted ? [...selected] : [...current.nodes]
    ).filter((id) =>
      nodeStore.state.graph?.nodes.some((node) => node.id === id)
    );
    if (!sameIds(selectedNodes, current.nodes)) {
      setNodeSelection({
        edges: nodeStore.state.selection.edges,
        nodes: selectedNodes,
      });
    }
  };

  const handleEdgesChange = (changes: FlowEdgeChange[]) => {
    const current = nodeStore.state.selection;
    const selected = new Set(current.edges);
    const removed: string[] = [];
    for (const change of changes) {
      if (change.type === "select") {
        if (change.selected) {
          selected.add(change.id);
        } else {
          selected.delete(change.id);
        }
      } else if (change.type === "remove") {
        removed.push(change.id);
      }
    }
    if (removed.length > 0) {
      commitNodeGraph(
        (latest) => removeEdges(latest, removed),
        nodeStore,
        "snapshot"
      );
    }
    const selectedEdges = [...selected].filter((id) => !removed.includes(id));
    if (!sameIds(selectedEdges, current.edges)) {
      setNodeSelection({
        edges: selectedEdges,
        nodes: nodeStore.state.selection.nodes,
      });
    }
  };

  // The drag's verdicts, taken when it started; React Flow asks on every
  // pointer move near a port.
  const isValidConnection = (connection: FlowConnection | FlowEdge) =>
    canConnect(
      dragGraph(),
      {
        source: connection.source,
        sourceHandle: connection.sourceHandle,
        target: connection.target,
        targetHandle: connection.targetHandle,
      },
      validateOptions
    );

  // Every port's verdict on the cable, once per drag: ports light up or
  // lock by it until the drag ends.
  const handleConnectStart: FlowConnectStart = (
    _event,
    { handleId, handleType, nodeId }
  ) => {
    if (handleId && handleType && nodeId) {
      startConnectionHints(
        dragGraph(),
        { handle: handleId, node: nodeId, type: handleType },
        validateOptions
      );
    }
  };

  const handleConnect = (connection: Connection) => {
    commitNodeGraph(
      (current) => connectNodes(current, connection),
      nodeStore,
      "snapshot"
    );
  };

  // The viewport persists when a pan, zoom or fit settles; it is never an
  // undo step of its own.
  const handleMoveEnd = (_event: unknown, viewport: FlowViewport) => {
    viewRef.current = viewport;
    commitNodeGraph(
      (current) => setGraphViewport(current, viewport),
      nodeStore,
      "rebase"
    );
  };

  // Rewire: drag either end of a cable onto another port. The old cable
  // goes and the new one comes in one undo step; a port that refuses says
  // why, as a new cable's would.
  const handleReconnectStart = (_event: unknown, edge: FlowEdge) => {
    rewireRef.current = { edge: edge.id, graph: removeEdges(graph, [edge.id]) };
  };

  // A refusal says why. On a phone it shows at the top, clear of the
  // node being wired and the canvas hint.
  const refuse = (message: string, action?: ExternalToast["action"]) => {
    if (!(action || isPhone)) {
      toast(message);
      return;
    }
    toast(message, { action, position: isPhone ? "top-center" : undefined });
  };

  const rewire = (edgeId: string, connection: Connection) => {
    const edit = reconnectEdge(graph, edgeId, connection, validateOptions);
    if (!edit.ok) {
      refuse(edit.message);
      return;
    }
    commitNodeGraph(
      (current) => {
        const latest = reconnectEdge(
          current,
          edgeId,
          connection,
          validateOptions
        );
        return latest.ok ? latest.graph : current;
      },
      nodeStore,
      "snapshot"
    );
  };

  const handleReconnect = (edge: FlowEdge, connection: FlowConnection) => {
    rewire(edge.id, connection);
  };

  // A cable end let go in space unplugs the cable, as in Pure Data.
  const unplugInSpace = (dropTarget: Element | null | undefined) => {
    const rewired = rewiring();
    if (rewired && dropTarget?.closest(".react-flow__pane")) {
      commitNodeGraph(
        (current) => removeEdges(current, [rewired.edge]),
        nodeStore,
        "snapshot"
      );
    }
  };

  const handleReconnectEnd = () => {
    rewireRef.current = null;
  };

  // Let go on a port, that port decides; on the body, the one port that
  // fits. A refusal says why in one toast, e.g. a Merge that would sum two
  // stations, a lane's second key, or a locked port's own reason.
  const dropOnto = (
    from: PaletteFrom,
    onNode: string,
    onPort: string | null
  ) => {
    const rewired = rewiring();
    const outcome = dropOnNode(
      dragGraph(),
      from,
      onNode,
      onPort,
      validateOptions
    );
    if ("connect" in outcome) {
      if (rewired) {
        rewire(rewired.edge, outcome.connect);
      } else {
        handleConnect(outcome.connect);
      }
    } else if (outcome.refuse) {
      const { replace } = outcome;
      // A rewired cable gone from the patch since its drag began, e.g. in
      // another tab, has nothing to put in the port's place: no Replace.
      const rewiredEdge = rewired
        ? graph.edges.find((edge) => edge.id === rewired.edge)
        : null;
      refuse(
        outcome.refuse,
        replace && rewiredEdge !== undefined
          ? {
              label: "Replace",
              onClick: () => replaceCable(replace, from.type, rewiredEdge),
            }
          : undefined
      );
    }
  };

  // Replace on a one-cable refusal: the port's cable moves to the new far
  // end, keeping its level. A cable being rewired onto the port takes its
  // place instead, and the port's old cable goes. One undo step. The toast
  // outlives the drop, so a port's cable, or the rewired cable, moved or
  // gone since is left alone.
  const replaceCable = (
    { connection, edge }: Replacement,
    fromType: PaletteFrom["type"],
    rewired: GraphEdge | null
  ) => {
    commitNodeGraph(
      (current) => {
        if (
          !(
            (rewired === null || unmoved(current, rewired)) &&
            holdsPort(current, edge, fromType, connection)
          )
        ) {
          return current;
        }
        const edit = rewired
          ? reconnectEdge(
              removeEdges(current, [edge]),
              rewired.id,
              connection,
              validateOptions
            )
          : reconnectEdge(current, edge, connection, validateOptions);
        return edit.ok ? edit.graph : current;
      },
      nodeStore,
      "snapshot"
    );
  };

  // A cable dropped on a node connects when exactly one of its ports fits,
  // and one refused by a port or a node says why; dropped on empty space,
  // it opens the palette narrowed to what fits.
  const handleConnectEnd = (
    event: MouseEvent | TouchEvent,
    connection: FlowConnectionEnd
  ) => {
    clearConnectionHints();
    const { fromHandle, fromNode, toHandle, toNode } = connection;
    if (connection.isValid || !(fromHandle?.id && fromNode)) {
      return;
    }
    const from: PaletteFrom = {
      handle: fromHandle.id,
      node: fromNode.id,
      type: fromHandle.type,
    };
    const pointer = pointerOf(event);
    const dropTarget = dropTargetOf(event, pointer);
    // The port let go on, or the one React Flow snapped to within reach.
    const portElement = dropTarget?.closest(".react-flow__handle");
    if (
      portElement?.getAttribute("data-nodeid") === from.node &&
      portElement?.getAttribute("data-handleid") === from.handle
    ) {
      // Let go where it started: nothing to explain.
      return;
    }
    const port =
      toHandle?.id && toNode && toHandle.type !== from.type
        ? { handle: toHandle.id, node: toNode.id }
        : facingPort(portElement, from);
    const onNode =
      port.node ??
      dropTarget?.closest(".react-flow__node")?.getAttribute("data-id");
    if (onNode) {
      dropOnto(from, onNode, port.handle);
      return;
    }
    if (rewiring()) {
      unplugInSpace(dropTarget);
      return;
    }
    if (
      !dropTarget?.closest(".react-flow__pane") ||
      paletteEntries(graph, { ...validateOptions, from }).length === 0
    ) {
      return;
    }
    const drop = screenToFlowPosition(pointer);
    // A node feeding an input sits left of the cursor, one fed by an output
    // right of it, so its port lands where the cable was let go.
    // It lands a little above, then moves level once measured.
    onOpenPalette({
      drop,
      edge: from.type === "target" ? "right" : "left",
      from,
      position: { x: drop.x, y: drop.y - 20 },
    });
  };

  // Tap-then-tap: the first tap lights the ports as a drag does. React
  // Flow connects a second tap the ports allow; one they refuse is let go
  // on that port, so it says why or takes the node's one fitting port.
  const handleClickConnectEnd = (event: MouseEvent | TouchEvent) => {
    const hints = clearConnectionHints();
    const { target } = event;
    const portElement =
      target instanceof Element ? target.closest(".react-flow__handle") : null;
    const onNode = portElement?.getAttribute("data-nodeid");
    const onHandle = portElement?.getAttribute("data-handleid");
    if (!(hints && onNode && onHandle)) {
      return;
    }
    const { from } = hints;
    if (onNode === from.node && onHandle === from.handle) {
      // The first port tapped again: the tap is taken back.
      return;
    }
    const port = facingPort(portElement, from);
    const cable: Connection =
      from.type === "source"
        ? {
            source: from.node,
            sourceHandle: from.handle,
            target: onNode,
            targetHandle: onHandle,
          }
        : {
            source: onNode,
            sourceHandle: onHandle,
            target: from.node,
            targetHandle: from.handle,
          };
    if (port.handle && canConnect(graph, cable, validateOptions)) {
      // React Flow has connected it already.
      return;
    }
    dropOnto(from, onNode, port.handle);
  };

  // A lone loose node dragged over a cable it fits into lights that cable;
  // each cable is checked once per hover, not on every pointer move.
  const handleNodeDrag = (
    event: MouseEvent | TouchEvent,
    node: { id: string },
    dragged: readonly { id: string }[]
  ) => {
    const latest = nodeStore.state.graph;
    if (
      insertionCanceledRef.current ||
      !latest ||
      dragged.length !== 1 ||
      !isLoose(latest, node.id)
    ) {
      probedRef.current = null;
      aimInsert(null);
      return;
    }
    const edge = edgeUnderPointer(pointerOf(event));
    const probed = probedRef.current;
    if (probed?.node === node.id && probed.edge === edge) {
      return;
    }
    probedRef.current = { edge, node: node.id };
    aimInsert(
      edge && insertNodeOnEdge(latest, node.id, edge, validateOptions).ok
        ? { edge, node: node.id }
        : null
    );
  };

  const handleNodeDragStop = () => {
    probedRef.current = null;
    aimInsert(null);
  };

  const handleDoubleClick = (event: React.MouseEvent) => {
    if (
      !(event.target instanceof Element) ||
      event.target.closest(".react-flow__node, .react-flow__edge") ||
      !event.target.closest(".react-flow__pane")
    ) {
      return;
    }
    onOpenPalette({
      position: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    });
  };

  // C on a focused node opens the Connect… dialog; with none focused, the
  // one selected node.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "c" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented ||
        !isCanvasKey(event.target, wrapperRef.current)
      ) {
        return;
      }
      const focused =
        event.target instanceof Element
          ? event.target.closest(".react-flow__node")?.getAttribute("data-id")
          : null;
      const { nodes: selected } = nodeStore.state.selection;
      const nodeId = focused ?? (selected.length === 1 ? selected[0] : null);
      if (!nodeId) {
        return;
      }
      event.preventDefault();
      onOpenConnect(nodeId);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenConnect]);

  // P puts two selected FX in series side by side (Split → both → Merge),
  // and S puts them back in series. Each is one undo step.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        !(key === "p" || key === "s") ||
        // A held key would flip the pair back or toast a refusal per repeat.
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented ||
        !isCanvasKey(event.target, wrapperRef.current)
      ) {
        return;
      }
      const selected = nodeStore.state.selection;
      const current = nodeStore.state.graph;
      if (!current || selected.nodes.length === 0) {
        return;
      }
      event.preventDefault();
      const edit = SERIES_PARALLEL_EDITS[key](current, selected, {
        profile: env.profile,
      });
      if (!edit.ok) {
        toast(edit.message);
        return;
      }
      commitNodeGraph(() => edit.graph, nodeStore, "snapshot");
      setNodeSelection(edit.selection);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [env.profile]);

  // A canvas that goes mid-drag leaves no ports lit behind it.
  useEffect(
    () => () => {
      clearConnectionHints();
    },
    []
  );

  // React Flow's first fit centres an untouched patch; on a phone it is
  // redone once the nodes are measured, so a tall patch opens on its top. A
  // pending reveal pans to its node instead, and a persisted viewport that
  // shows the patch stays.
  useEffect(() => {
    if (!(isPhone && nodesInitialized) || phoneAlignedRef.current) {
      return;
    }
    phoneAlignedRef.current = true;
    if (
      !reveal &&
      needsFit(fitTools, wrapperRef.current, isPhone, initialViewport)
    ) {
      fitPatch(fitTools, wrapperRef.current, isPhone);
    }
  }, [fitTools, initialViewport, isPhone, nodesInitialized, reveal]);

  // A patch replaced in place, as an import does, brings its own view.
  const { x: viewX, y: viewY, zoom: viewZoom } = graph.viewport;
  useEffect(() => {
    const viewport = { x: viewX, y: viewY, zoom: viewZoom };
    if (sameViewport(viewport, viewRef.current)) {
      return;
    }
    // A frame for the new patch's nodes to be measured.
    const frame = requestAnimationFrame(() => {
      viewRef.current = viewport;
      if (needsFit(fitTools, wrapperRef.current, isPhone, viewport)) {
        fitPatch(fitTools, wrapperRef.current, isPhone);
      } else {
        fitTools.setViewport(viewport);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [fitTools, isPhone, viewX, viewY, viewZoom]);

  // A template load can move everything; fit it back in view, once.
  useEffect(() => {
    if (fitRequest === 0) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      fitPatch(fitTools, wrapperRef.current, isPhone, 200);
      onFitHandled?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [fitRequest, fitTools, isPhone, onFitHandled]);

  // F fits the patch in view, unless typing or inside a menu or dialog.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "f" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented
      ) {
        return;
      }
      if (isShortcutIgnored(event.target)) {
        return;
      }
      event.preventDefault();
      fitPatch(fitTools, wrapperRef.current, isPhone, 200);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fitTools, isPhone]);

  // Delete heals, B bypasses, I inserts into a cable and Cmd+D duplicates.
  // React Flow's own delete key would listen on the whole document, so a
  // Backspace in the Stage, the Rack or a dialog deleted the selection.
  useCableSurgeryShortcuts({
    canvasRef: wrapperRef,
    onInsertInto: onOpenPalette,
    validateOptions,
  });

  // A node picked for a cable let go in space moves, once measured, so the
  // port the cable takes is level with where it was let go, whatever the
  // node's height. It stays the one undo step that added it.
  useEffect(() => {
    if (!portDrop) {
      return;
    }
    let frame = 0;
    let framesLeft = REVEAL_MEASURE_FRAMES;
    const level = () => {
      const port = droppedPort(nodeStore.state.graph, portDrop);
      const handles = getInternalNode(portDrop.nodeId)?.internals.handleBounds;
      const bounds = port && handles?.[port.side];
      const handle = bounds?.find((entry) => entry.id === port?.handle);
      if (!handle && framesLeft > 0) {
        framesLeft -= 1;
        frame = requestAnimationFrame(level);
        return;
      }
      onPortDropHandled?.();
      if (!handle) {
        return;
      }
      const y = portDrop.y - (handle.y + handle.height / 2);
      commitNodeGraph(
        (current) => {
          const node = current.nodes.find(
            (entry) => entry.id === portDrop.nodeId
          );
          return node
            ? moveNodes(
                current,
                new Map([[node.id, { x: node.position.x, y }]])
              )
            : current;
        },
        nodeStore,
        "rebase"
      );
    };
    frame = requestAnimationFrame(level);
    return () => cancelAnimationFrame(frame);
  }, [getInternalNode, onPortDropHandled, portDrop]);

  // Pan to a Station added from the search bar when it lands out of view.
  // A node not measured yet is waited for a few frames, then taken as one
  // Station row, so a tall new node is not judged in view by its top edge.
  useEffect(() => {
    if (!reveal) {
      return;
    }
    let frame = 0;
    let framesLeft = REVEAL_MEASURE_FRAMES;
    const panTo = () => {
      const node = getInternalNode(reveal.nodeId);
      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!(node && bounds)) {
        return;
      }
      if (node.measured.height === undefined && framesLeft > 0) {
        framesLeft -= 1;
        frame = requestAnimationFrame(panTo);
        return;
      }
      const { x, y } = node.internals.positionAbsolute;
      const width = node.measured.width ?? STATION_WIDTH;
      const height = node.measured.height ?? STATION_ROW_HEIGHT;
      const topLeft = flowToScreenPosition({ x, y });
      const bottomRight = flowToScreenPosition({
        x: x + width,
        y: y + height,
      });
      if (
        topLeft.x >= bounds.left &&
        topLeft.y >= bounds.top &&
        bottomRight.x <= bounds.right &&
        bottomRight.y <= bounds.bottom - HINT_CLEARANCE
      ) {
        return;
      }
      setCenter(x + width / 2, y + height / 2, {
        duration: 250,
        zoom: getZoom(),
      });
    };
    frame = requestAnimationFrame(panTo);
    return () => cancelAnimationFrame(frame);
  }, [flowToScreenPosition, getInternalNode, getZoom, reveal, setCenter]);

  return (
    <div
      className="absolute inset-0"
      onLostPointerCapture={handleLostPointerCapture}
      onMouseDownCapture={startInsertion}
      onPointerCancelCapture={cancelInsertion}
      onTouchCancelCapture={cancelInsertion}
      onTouchMoveCapture={handleTouchMoveCapture}
      onTouchStartCapture={handleTouchStartCapture}
      ref={wrapperRef}
    >
      <ReactFlow
        ariaLabelConfig={NODE_ARIA_LABELS}
        connectionMode={ConnectionMode.Strict}
        connectionRadius={24}
        defaultViewport={initialViewport}
        deleteKeyCode={null}
        edges={edges}
        edgeTypes={edgeTypes}
        fitView={isUntouchedViewport(initialViewport)}
        fitViewOptions={fitViewOptions}
        isValidConnection={isValidConnection}
        maxZoom={1.5}
        minZoom={0.25}
        nodes={nodes}
        nodeTypes={nodeTypes}
        onClickConnectEnd={handleClickConnectEnd}
        onClickConnectStart={handleConnectStart}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        onConnectStart={handleConnectStart}
        onDoubleClick={handleDoubleClick}
        onEdgesChange={handleEdgesChange}
        onMoveEnd={handleMoveEnd}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onNodesChange={handleNodesChange}
        onReconnect={handleReconnect}
        onReconnectEnd={handleReconnectEnd}
        onReconnectStart={handleReconnectStart}
        panActivationKeyCode={null}
        proOptions={PRO_OPTIONS}
        // A cable end to rewire is hard to hit at a phone's zoom.
        reconnectRadius={isPhone ? 24 : 10}
        zoomOnDoubleClick={false}
      />
    </div>
  );
}

/** The patch canvas. Lives in its own client chunk with React Flow. */
export default function NodeCanvas(props: NodeCanvasProps) {
  const graph = useNodeGraph();
  if (!graph) {
    return null;
  }
  return (
    <ReactFlowProvider>
      <FlowPortsRoot>
        <Canvas graph={graph} {...props} />
      </FlowPortsRoot>
    </ReactFlowProvider>
  );
}
