/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import "@/styles/node-mode.css";
import { useStore } from "@tanstack/react-store";
import { useEffect, useRef, useState } from "react";
import { laneChannelId } from "@/lib/node-graph/compile";
import {
  addEmptyStationNode,
  connectNodes,
  moveNodes,
  removeEdges,
  removeNodes,
} from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  setNodeSelection,
  useNodeGraph,
  useNodeSelection,
} from "@/lib/node-graph/node-store";
import type { GraphNode, NodeGraph } from "@/lib/node-graph/schema";
import { validateConnection } from "@/lib/node-graph/validate";
import { detectNodePlaybackEnv } from "@/lib/node-playback";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";
import {
  type FlowConnection,
  type FlowConnectionEnd,
  type FlowEdge,
  type FlowEdgeChange,
  type FlowNode,
  type FlowNodeChange,
  type FlowNodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "./flow-adapter";
import { SpeakersNode } from "./speakers-node";
import { StationNode } from "./station-node";

type Point = { x: number; y: number };
type Size = { width: number; height: number };

const nodeTypes = {
  speakers: SpeakersNode,
  station: StationNode,
} satisfies FlowNodeTypes;

/** Station node width, so a dropped slot lands with its port at the cursor. */
const STATION_WIDTH = 240;
const FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.2 };
const DELETE_KEYS = ["Backspace", "Delete"];
const KEY_IGNORED_TARGETS = "input, textarea, select, [contenteditable=true]";

function isDrawn(node: GraphNode): node is GraphNode & {
  type: keyof typeof nodeTypes;
} {
  return node.type in nodeTypes;
}

function nodeLabel(node: GraphNode | undefined): string {
  if (node?.type === "station") {
    return node.data.radio?.name ?? "Empty Station";
  }
  return node?.type === "speakers" ? "Speakers" : "node";
}

function pointerOf(event: MouseEvent | TouchEvent): Point {
  const point = "changedTouches" in event ? event.changedTouches[0] : event;
  return { x: point?.clientX ?? 0, y: point?.clientY ?? 0 };
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

export type NodeCanvasProps = {
  /** A Station the search bar just added; the view pans to it if hidden. */
  reveal: { nodeId: string } | null;
};

function Canvas({ graph, reveal }: NodeCanvasProps & { graph: NodeGraph }) {
  const selection = useNodeSelection();
  const runtimes = useStore(playbackRuntimeStore, (state) => state.channels);
  const [dragPositions, setDragPositions] = useState<
    ReadonlyMap<string, Point>
  >(new Map());
  const [measured, setMeasured] = useState<ReadonlyMap<string, Size>>(
    new Map()
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const {
    fitView,
    flowToScreenPosition,
    getInternalNode,
    getZoom,
    screenToFlowPosition,
    setCenter,
  } = useReactFlow();

  const drawn = graph.nodes.filter(isDrawn);
  const byId = new Map(drawn.map((node) => [node.id, node]));
  const nodes = drawn.map(
    (node): FlowNode => ({
      data: node.data,
      deletable: node.type !== "speakers",
      domAttributes: { "aria-roledescription": "audio module" },
      id: node.id,
      measured: measured.get(node.id),
      position: dragPositions.get(node.id) ?? node.position,
      selected: selection.nodes.includes(node.id),
      type: node.type,
    })
  );
  const edges = graph.edges
    .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
    .map(
      (edge): FlowEdge => ({
        ariaLabel: `${nodeLabel(byId.get(edge.source))} audio to ${nodeLabel(byId.get(edge.target))}`,
        className: runtimes[laneChannelId(edge.source)]?.isPlaying
          ? "node-edge-live"
          : undefined,
        id: edge.id,
        selected: selection.edges.includes(edge.id),
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: edge.target,
        targetHandle: edge.targetHandle,
      })
    );

  const handleNodesChange = (changes: FlowNodeChange[]) => {
    const batch: NodeChangeBatch = {
      dragging: new Map(dragPositions),
      dropped: new Map(),
      removed: [],
      selected: new Set(selection.nodes),
      sizes: new Map(measured),
    };
    for (const change of changes) {
      foldNodeChange(batch, change);
    }
    const { dragging, dropped, removed, selected, sizes } = batch;
    setDragPositions(dragging);
    setMeasured(sizes);
    // Positions persist on drag stop, not on every pointer move.
    if (dropped.size > 0) {
      commitNodeGraph((current) => moveNodes(current, dropped));
    }
    if (removed.length > 0) {
      commitNodeGraph((current) => removeNodes(current, removed));
    }
    setNodeSelection({
      edges: selection.edges,
      nodes: [...selected].filter((id) => !removed.includes(id)),
    });
  };

  const handleEdgesChange = (changes: FlowEdgeChange[]) => {
    const selected = new Set(selection.edges);
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
      commitNodeGraph((current) => removeEdges(current, removed));
    }
    setNodeSelection({
      edges: [...selected].filter((id) => !removed.includes(id)),
      nodes: selection.nodes,
    });
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
      { profile: detectNodePlaybackEnv().profile }
    ).length === 0;

  const handleConnect = (connection: FlowConnection) => {
    commitNodeGraph((current) => connectNodes(current, connection));
  };

  // A cable dropped from an audio input onto empty space brings a Station
  // slot to feed it; the palette for every other kind comes later.
  const handleConnectEnd = (
    event: MouseEvent | TouchEvent,
    connection: FlowConnectionEnd
  ) => {
    const { fromHandle, fromNode } = connection;
    const dropTarget = event.target instanceof Element ? event.target : null;
    if (
      connection.isValid ||
      !(fromHandle?.id && fromNode) ||
      fromHandle.type !== "target" ||
      !fromHandle.id.startsWith("in:audio:") ||
      !dropTarget?.closest(".react-flow__pane")
    ) {
      return;
    }
    const drop = screenToFlowPosition(pointerOf(event));
    const handle = fromHandle.id;
    commitNodeGraph(
      (current) =>
        addEmptyStationNode(
          current,
          { x: drop.x - STATION_WIDTH, y: drop.y - 20 },
          { handle, node: fromNode.id }
        ).graph
    );
  };

  // F fits the patch in view, unless typing.
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
      const { target } = event;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest(KEY_IGNORED_TARGETS))
      ) {
        return;
      }
      event.preventDefault();
      fitView({ ...FIT_VIEW_OPTIONS, duration: 200 });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fitView]);

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
        connectionRadius={24}
        deleteKeyCode={DELETE_KEYS}
        edges={edges}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        isValidConnection={isValidConnection}
        maxZoom={1.5}
        minZoom={0.25}
        nodes={nodes}
        nodeTypes={nodeTypes}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        onEdgesChange={handleEdgesChange}
        onNodesChange={handleNodesChange}
        panActivationKeyCode={null}
      />
    </div>
  );
}

/** The patch canvas. Lives in its own client chunk with React Flow. */
export default function NodeCanvas({ reveal }: NodeCanvasProps) {
  const graph = useNodeGraph();
  if (!graph) {
    return null;
  }
  return (
    <ReactFlowProvider>
      <Canvas graph={graph} reveal={reveal} />
    </ReactFlowProvider>
  );
}
