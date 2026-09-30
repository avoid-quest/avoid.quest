/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import "@/styles/node-mode.css";
import { useStore } from "@tanstack/react-store";
import { useEffect, useRef, useState } from "react";
import {
  connectNodes,
  moveNodes,
  removeEdges,
  removeNodes,
  removeSelection,
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
  autoConnection,
  type PaletteFrom,
  paletteEntries,
} from "@/lib/node-graph/palette";
import type { NodeGraph } from "@/lib/node-graph/schema";
import { type Connection, validateConnection } from "@/lib/node-graph/validate";
import { detectNodePlaybackEnv } from "@/lib/node-playback";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";
import {
  type FlowConnection,
  type FlowConnectionEnd,
  type FlowEdge,
  type FlowEdgeChange,
  type FlowNodeChange,
  type FlowNodeTypes,
  type FlowViewport,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "./flow-adapter";
import {
  dropTargetOf,
  NODE_ARIA_LABELS,
  pointerOf,
  toFlowEdges,
  toFlowNodes,
} from "./flow-elements";
import {
  isCanvasKey,
  isShortcutIgnored,
  type PaletteRequest,
} from "./node-palette";
import { SpeakersNode } from "./speakers-node";
import { StationNode } from "./station-node";

type Point = { x: number; y: number };
type Size = { width: number; height: number };

const nodeTypes = {
  speakers: SpeakersNode,
  station: StationNode,
} satisfies FlowNodeTypes;

/** Station node width, so a node fed from an input lands with its port at the cursor. */
const STATION_WIDTH = 240;
const FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.2 };
const DELETE_KEYS = ["Backspace", "Delete"];

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
  const {
    fitView,
    flowToScreenPosition,
    getInternalNode,
    getZoom,
    screenToFlowPosition,
    setCenter,
  } = useReactFlow();
  const validateOptions = { profile: detectNodePlaybackEnv().profile };

  const nodes = toFlowNodes(graph, {
    measured,
    positions: dragPositions,
    selection,
  });
  const edges = toFlowEdges(graph, { liveLanes, selection });

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
    // drag is one undo step.
    if (dropped.size > 0) {
      commitNodeGraph(
        (latest) => moveNodes(latest, dropped),
        nodeStore,
        "snapshot"
      );
    }
    if (removed.length > 0) {
      commitNodeGraph(
        (latest) => removeNodes(latest, removed),
        nodeStore,
        "snapshot"
      );
    }
    const selectedNodes = [...selected].filter((id) => !removed.includes(id));
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
      const cable = autoConnection(graph, from, onNode, validateOptions);
      if (cable) {
        handleConnect(cable);
      }
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
      from,
      position: {
        x: from.type === "target" ? drop.x - STATION_WIDTH : drop.x,
        y: drop.y - 20,
      },
    });
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

  // Delete and Backspace remove the selection. React Flow would listen on
  // the whole document, so a Backspace on a button in the Stage, the Rack
  // or a dialog deleted the selected Station; only the canvas, or nothing
  // focused, counts here.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const { target } = event;
      if (
        !DELETE_KEYS.includes(event.key) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented ||
        !isCanvasKey(target, wrapperRef.current)
      ) {
        return;
      }
      const selected = nodeStore.state.selection;
      if (selected.nodes.length === 0 && selected.edges.length === 0) {
        return;
      }
      event.preventDefault();
      commitNodeGraph(
        (latest) => removeSelection(latest, selected),
        nodeStore,
        "snapshot"
      );
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
    <div className="absolute inset-0" ref={wrapperRef}>
      <ReactFlow
        ariaLabelConfig={NODE_ARIA_LABELS}
        connectionRadius={24}
        defaultViewport={initialViewport}
        deleteKeyCode={null}
        edges={edges}
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
        onNodesChange={handleNodesChange}
        panActivationKeyCode={null}
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
      <Canvas graph={graph} {...props} />
    </ReactFlowProvider>
  );
}
