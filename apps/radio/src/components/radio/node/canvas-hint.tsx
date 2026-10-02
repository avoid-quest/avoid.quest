import { isRadioSourceNode, type NodeGraph } from "@/lib/node-graph/schema";
import { EmptyHint } from "../empty-hint";

/** Whether some source in the patch holds something to play. */
export function hasFilledSource(graph: Pick<NodeGraph, "nodes">): boolean {
  return graph.nodes.some(
    (node) => isRadioSourceNode(node) && node.data.radio !== null
  );
}

/** What to do first in a patch with nothing to play. */
function firstStep(graph: NodeGraph, isPhone: boolean): string {
  // `/` needs a keyboard; on a phone the toolbar's + opens the same palette.
  const addNode = isPhone ? "tap + to add a node" : "press / to add a node";
  const slot = graph.nodes.find(isRadioSourceNode);
  if (!slot) {
    return `Search to add a station, or ${addNode}`;
  }
  return slot.type === "station"
    ? `Search a station in the slot, or ${addNode}`
    : `Fill the ${slot.type === "file" ? "File" : "Track"}, or ${addNode}`;
}

/**
 * The canvas's one line of direction. Until a source holds a station,
 * Play all has nothing to start, so it says what to do first; after that it
 * points at the cable gesture.
 */
export function NodeCanvasHint({
  graph,
  isPhone = false,
}: {
  graph: NodeGraph | null;
  isPhone?: boolean;
}) {
  if (graph && !hasFilledSource(graph)) {
    return (
      <EmptyHint className="pointer-events-none absolute inset-x-0 bottom-0 z-10 py-4 md:py-4">
        {firstStep(graph, isPhone)}
      </EmptyHint>
    );
  }
  return (
    <p className="pointer-events-none absolute bottom-2 left-3 z-10 text-muted-foreground text-xs">
      Drag a cable to empty space to add a node
    </p>
  );
}
