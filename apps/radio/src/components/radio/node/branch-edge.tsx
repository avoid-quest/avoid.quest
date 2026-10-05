/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@avoid.quest/ui/components/popover";
import { cn } from "@avoid.quest/ui/lib/utils";
import { BranchControls, branchSummary } from "./branch-controls";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type FlowEdge,
  type FlowEdgeProps,
  getBezierPath,
} from "./flow-adapter";
import type { BranchEdgeData } from "./flow-elements";
import { keepControlKeys } from "./module-frame";

/**
 * Branch Edge
 *
 * A cable out of a Split, Stereo Split or Band Split is a branch, and it
 * carries that branch's gain, pan, mute and solo. It draws as a plain wire
 * with a small tag at its middle ("2", "L", "Mid", plus what is set), and
 * the tag opens the branch's controls. The inspector lists the same
 * controls for every branch, so a phone reaches them from the Rack.
 */

export type BranchFlowEdge = FlowEdge<BranchEdgeData, "branch">;

/** A branch cable on the canvas: the wire, and its tag with the controls. */
export function BranchEdge({
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
}: FlowEdgeProps<BranchFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  });
  if (!data) {
    return <BaseEdge id={id} markerEnd={markerEnd} path={path} />;
  }
  const summary = branchSummary(data);
  const described = [data.name, ...summary].join(", ");
  return (
    <>
      <BaseEdge
        id={id}
        interactionWidth={interactionWidth}
        markerEnd={markerEnd}
        path={path}
        style={style}
      />
      <EdgeLabelRenderer>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; the tag is a button itself */}
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; the tag is a button itself */}
        <div
          className="nodrag nopan absolute"
          onKeyDown={keepControlKeys}
          style={{
            pointerEvents: "all",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <Popover>
            <PopoverTrigger asChild>
              <button
                aria-label={`${described}: branch settings`}
                className={cn(
                  "flex h-4 items-center gap-1 rounded-sm border border-border/50 bg-card px-1 text-[10px] text-muted-foreground tabular-nums leading-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  data.muted && "opacity-60",
                  data.solo && "border-primary/40 text-primary"
                )}
                title={`${described}. Level is base + cable trim. Click for cable trim, pan, mute and solo`}
                type="button"
              >
                <span className={cn(data.muted && "line-through")}>
                  {data.tag}
                </span>
                {summary.length > 0 ? (
                  <span className="text-muted-foreground">
                    {summary.join(" · ")}
                  </span>
                ) : null}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="center"
              className="w-auto p-2"
              onKeyDown={keepControlKeys}
              side="top"
            >
              <p className="mb-1.5 font-medium text-xs">{data.name}</p>
              <BranchControls data={data} edgeId={id} />
            </PopoverContent>
          </Popover>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
