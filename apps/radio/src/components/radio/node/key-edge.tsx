import {
  BaseEdge,
  EdgeLabelRenderer,
  type FlowEdge,
  type FlowEdgeProps,
  getBezierPath,
} from "./flow-adapter";
import type { KeyEdgeData } from "./flow-elements";

/**
 * Key Edge
 *
 * A key cable feeds a station into the sidechain of a Compressor, Gate or
 * Vocoder: the effect listens to it rather than playing it. It draws in the
 * Key amber with long 6/4 dashes (node-mode.css), so it reads apart from
 * the solid audio wires without relying on colour. A key that keys nothing,
 * such as a lane's second key, fades and wears a small "idle" tag whose
 * title says why; the cable's accessible name says the same.
 */

export type KeyFlowEdge = FlowEdge<KeyEdgeData, "key">;

export function KeyEdge({
  id,
  data,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  interactionWidth,
}: FlowEdgeProps<KeyFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  });
  const idle = data?.idle ?? null;
  return (
    <>
      <BaseEdge
        id={id}
        interactionWidth={interactionWidth}
        markerEnd={markerEnd}
        path={path}
        style={style}
      />
      {idle ? (
        <EdgeLabelRenderer>
          <span
            aria-hidden
            className="nodrag nopan absolute rounded-sm border border-border/50 bg-card px-1 text-[10px] text-muted-foreground leading-4"
            style={{
              pointerEvents: "all",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            title={idle}
          >
            idle
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
