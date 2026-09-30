import type { NodeGraph } from "@/lib/node-graph/schema";
import { EmptyHint } from "../empty-hint";

/** Whether some source in the patch holds something to play. */
export function hasFilledSource(graph: Pick<NodeGraph, "nodes">): boolean {
  return graph.nodes.some(
    (node) => node.type === "station" && node.data.radio !== null
  );
}

/**
 * The canvas's one line of direction. Until a source holds a station,
 * Play all has nothing to start, so it says what to do first; after that it
 * points at the cable gesture.
 */
export function NodeCanvasHint({ graph }: { graph: NodeGraph | null }) {
  if (graph && !hasFilledSource(graph)) {
    return (
      <EmptyHint className="pointer-events-none absolute inset-x-0 bottom-0 z-10 py-4 md:py-4">
        Search a station in the slot, or press / to add a node
      </EmptyHint>
    );
  }
  return (
    <p className="pointer-events-none absolute bottom-2 left-3 z-10 text-muted-foreground text-xs">
      Drag a cable to empty space to add a node
    </p>
  );
}
