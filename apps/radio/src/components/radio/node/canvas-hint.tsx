import {
  isRadioSourceNode,
  isStripSource,
  type NodeGraph,
} from "@/lib/node-graph/schema";
import { EmptyHint } from "../empty-hint";

/** Whether some source in the patch holds something to play. */
export function hasFilledSource(graph: Pick<NodeGraph, "nodes">): boolean {
  return graph.nodes.some(
    (node) =>
      (isRadioSourceNode(node) && node.data.radio !== null) ||
      (node.type === "deviceIn" && node.data.deviceId !== null)
  );
}

/** What to do first in a patch with nothing to play. */
function firstStep(graph: NodeGraph, isPhone: boolean): string {
  // `/` needs a keyboard; on a phone the toolbar's + opens the same palette.
  const addNode = isPhone ? "tap + to add a node" : "press / to add a node";
  const slot = graph.nodes.find(isStripSource);
  if (!slot) {
    return `Search to add a source, or ${addNode}`;
  }
  if (slot.type === "deviceIn") {
    return "Choose an input on the node, then Go live to start capture";
  }
  if (slot.type === "station") {
    return `Search a station in the slot, or ${addNode}`;
  }
  if (slot.type === "file") {
    return `Choose a file, or ${addNode}`;
  }
  return `Search tracks, shows or stations, or ${addNode}`;
}

/**
 * The canvas's one line of direction. Until a source holds something to
 * play, it says what to do first; after that it points at the cable gesture.
 */
export function NodeCanvasHint({
  graph,
  isPhone = false,
}: {
  graph: NodeGraph | null;
  isPhone?: boolean;
}) {
  if (!graph) {
    return null;
  }
  if (!hasFilledSource(graph)) {
    return (
      <EmptyHint className="pointer-events-none absolute inset-x-0 bottom-0 z-10 py-4 md:py-4">
        {firstStep(graph, isPhone)}
      </EmptyHint>
    );
  }
  return (
    <p className="pointer-events-none absolute inset-x-3 bottom-2 z-10 text-muted-foreground text-xs">
      {isPhone
        ? "Drag between ports to connect nodes"
        : "Drag between ports to connect, or to empty space to add a node"}
    </p>
  );
}
