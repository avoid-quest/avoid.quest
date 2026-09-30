/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import "@/styles/node-mode.css";
import { useStore } from "@tanstack/react-store";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { isEffectContainerType } from "@/lib/audio/dsp/routing/effect-tree";
import { isEffectNodeType } from "@/lib/node-graph/catalogue";
import { compile, idleKeys, mergeRoles } from "@/lib/node-graph/compile";
import {
  connectNodes,
  insertNodeOnEdge,
  isLoose,
  moveNodes,
  removeEdges,
  removeNodesHealed,
  setViewport,
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
} from "@/lib/node-graph/palette";
import type { NodeGraph } from "@/lib/node-graph/schema";
import {
  parallelToSeries,
  seriesToParallel,
} from "@/lib/node-graph/series-parallel";
import {
  type Connection,
  type ValidateOptions,
  validateConnection,
} from "@/lib/node-graph/validate";
import { detectNodePlaybackEnv } from "@/lib/node-playback";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";
import { BranchEdge } from "./branch-edge";
import { useCableSurgeryShortcuts } from "./cable-surgery";
import { EffectNode } from "./effect-node";
import {
  type FlowConnection,
  type FlowConnectionEnd,
  type FlowEdge,
  type FlowEdgeChange,
  type FlowEdgeTypes,
  type FlowNodeChange,
  type FlowNodeTypes,
  type FlowViewport,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
} from "./flow-adapter";
import {
  DRAWN_NODE_TYPES,
  dropTargetOf,
  edgeUnderPointer,
  NODE_ARIA_LABELS,
  pointerOf,
  toFlowEdges,
  toFlowNodes,
} from "./flow-elements";
import { KeyEdge } from "./key-edge";
import { MergeNode } from "./merge-node";
import { type FlowPorts, FlowPortsProvider } from "./module-frame";
import { NativeStripNode } from "./native-strip-nodes";
import {
  isCanvasKey,
  isShortcutIgnored,
  type PaletteRequest,
} from "./node-palette";
import { SpeakersNode } from "./speakers-node";
import { SplitNode } from "./split-nodes";
import { StationNode } from "./station-node";

type Point = { x: number; y: number };
type Size = { width: number; height: number };

const nodeTypes = {
  // Every drawn effect shares one node, and every split another; Station
  // and Speakers come last.
  ...Object.fromEntries(
    DRAWN_NODE_TYPES.filter(isEffectNodeType).map((type) => [
      type,
      isEffectContainerType(type) ? SplitNode : EffectNode,
    ])
  ),
  filter: NativeStripNode,
  gain: NativeStripNode,
  merge: MergeNode,
  pan: NativeStripNode,
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
/** No React Flow attribution in the canvas corner. */
const PRO_OPTIONS = { hideAttribution: true };

/** A loose node dragged over a cable it can go into. */
type InsertTarget = { node: string; edge: string };

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

export type NodeCanvasProps = {
  /** A Station the search bar just added; the view pans to it if hidden. */
  reveal: { nodeId: string } | null;
  /** Bumped to fit the patch in view, e.g. after a template loads. */
  fitRequest: number;
  /** Opens the add-node palette: double-click, or a cable dropped in space. */
  onOpenPalette: (request: PaletteRequest) => void;
  /** C on a focused node opens the keyboard Connect… dialog for it. */
  onOpenConnect: (nodeId: string) => void;
};

function Canvas({
  graph,
  reveal,
  fitRequest,
  onOpenPalette,
  onOpenConnect,
}: NodeCanvasProps & { graph: NodeGraph }) {
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  // The cable a dragged node would go into if let go now: state to
  // highlight it, a ref for the drop, which reads it in the same event.
  const [insertTarget, setInsertTarget] = useState<InsertTarget | null>(null);
  const insertTargetRef = useRef<InsertTarget | null>(null);
  const probedRef = useRef<{ node: string; edge: string | null } | null>(null);
  const insertionCanceledRef = useRef(false);
  const {
    fitView,
    flowToScreenPosition,
    getInternalNode,
    getZoom,
    screenToFlowPosition,
    setCenter,
  } = useReactFlow();
  const [env] = useState(detectNodePlaybackEnv);
  const validateOptions = { profile: env.profile };
  // The compiler's verdict on each Merge, for its in-lane badge, and on
  // each key cable, for its idle tag.
  const plan = compile(graph, env);
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
      previous?.edge === target?.edge && previous?.node === target?.node
        ? previous
        : target
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

  const isValidConnection = (connection: FlowConnection | FlowEdge) =>
    validateConnection(
      graph,
      {
        source: connection.source,
        sourceHandle: connection.sourceHandle,
        target: connection.target,
        targetHandle: connection.targetHandle,
      },
      validateOptions
    ).length === 0;

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
    commitNodeGraph(
      (current) => setViewport(current, viewport),
      nodeStore,
      "rebase"
    );
  };

  // Let go on a port, that port decides; on the body, the one port that
  // fits. A refusal says why, e.g. a Merge that would sum two stations, or
  // a lane's second key.
  const dropOnto = (
    connection: FlowConnectionEnd,
    from: PaletteFrom,
    onNode: string
  ) => {
    const { toHandle, toNode } = connection;
    const onPort =
      toHandle?.id && toNode && toHandle.type !== from.type
        ? { handle: toHandle.id, node: toNode.id }
        : null;
    const outcome = dropOnNode(
      graph,
      from,
      onPort?.node ?? onNode,
      onPort?.handle ?? null,
      validateOptions
    );
    if ("connect" in outcome) {
      handleConnect(outcome.connect);
    } else if (outcome.refuse) {
      toast(outcome.refuse);
    }
  };

  // A cable dropped on a node connects when exactly one of its ports fits;
  // dropped on empty space, it opens the palette narrowed to what fits.
  const handleConnectEnd = (
    event: MouseEvent | TouchEvent,
    connection: FlowConnectionEnd
  ) => {
    const { fromHandle, fromNode } = connection;
    const pointer = pointerOf(event);
    const dropTarget = dropTargetOf(event, pointer);
    if (connection.isValid || !(fromHandle?.id && fromNode && dropTarget)) {
      return;
    }
    const from: PaletteFrom = {
      handle: fromHandle.id,
      node: fromNode.id,
      type: fromHandle.type,
    };
    const onNode = dropTarget
      .closest(".react-flow__node")
      ?.getAttribute("data-id");
    if (onNode) {
      dropOnto(connection, from, onNode);
      return;
    }
    if (
      !dropTarget.closest(".react-flow__pane") ||
      paletteEntries(graph, { ...validateOptions, from }).length === 0
    ) {
      return;
    }
    const drop = screenToFlowPosition(pointer);
    // A node feeding an input sits left of the cursor, one fed by an output
    // right of it, so its port lands where the cable was let go.
    onOpenPalette({
      edge: from.type === "target" ? "right" : "left",
      from,
      position: { x: drop.x, y: drop.y - 20 },
    });
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
      const edit = SERIES_PARALLEL_EDITS[key](current, selected);
      if (!edit.ok) {
        toast(edit.message);
        return;
      }
      commitNodeGraph(() => edit.graph, nodeStore, "snapshot");
      setNodeSelection(edit.selection);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // A template load can move everything; fit it back in view.
  useEffect(() => {
    if (fitRequest === 0) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      fitView({ ...FIT_VIEW_OPTIONS, duration: 200 });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitRequest, fitView]);

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
      fitView({ ...FIT_VIEW_OPTIONS, duration: 200 });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fitView]);

  // Delete heals, B bypasses, I inserts into a cable and Cmd+D duplicates.
  // React Flow's own delete key would listen on the whole document, so a
  // Backspace in the Stage, the Rack or a dialog deleted the selection.
  useCableSurgeryShortcuts({
    canvasRef: wrapperRef,
    onInsertInto: onOpenPalette,
    validateOptions,
  });

  // Pan to a Station added from the search bar when it lands out of view.
  useEffect(() => {
    if (!reveal) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const node = getInternalNode(reveal.nodeId);
      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!(node && bounds)) {
        return;
      }
      const { x, y } = node.internals.positionAbsolute;
      const width = node.measured.width ?? STATION_WIDTH;
      const height = node.measured.height ?? 0;
      const topLeft = flowToScreenPosition({ x, y });
      const bottomRight = flowToScreenPosition({
        x: x + width,
        y: y + height,
      });
      if (
        topLeft.x >= bounds.left &&
        topLeft.y >= bounds.top &&
        bottomRight.x <= bounds.right &&
        bottomRight.y <= bounds.bottom
      ) {
        return;
      }
      setCenter(x + width / 2, y + height / 2, {
        duration: 250,
        zoom: getZoom(),
      });
    });
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
        connectionRadius={24}
        defaultViewport={initialViewport}
        deleteKeyCode={null}
        edges={edges}
        edgeTypes={edgeTypes}
        fitView={isUntouchedViewport(initialViewport)}
        fitViewOptions={FIT_VIEW_OPTIONS}
        isValidConnection={isValidConnection}
        maxZoom={1.5}
        minZoom={0.25}
        nodes={nodes}
        nodeTypes={nodeTypes}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        onDoubleClick={handleDoubleClick}
        onEdgesChange={handleEdgesChange}
        onMoveEnd={handleMoveEnd}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onNodesChange={handleNodesChange}
        panActivationKeyCode={null}
        proOptions={PRO_OPTIONS}
        zoomOnDoubleClick={false}
      />
    </div>
  );
}

/** What node ports draw with; only the canvas chunk loads React Flow. */
function FlowPortsRoot({ children }: { children: ReactNode }) {
  const updateNodeInternals = useUpdateNodeInternals();
  const ports: FlowPorts = { Handle, Position, updateNodeInternals };
  return <FlowPortsProvider value={ports}>{children}</FlowPortsProvider>;
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
