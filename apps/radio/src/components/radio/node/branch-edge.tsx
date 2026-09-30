/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@avoid.quest/ui/components/popover";
import { Toggle } from "@avoid.quest/ui/components/toggle";
import { cn } from "@avoid.quest/ui/lib/utils";
import { paramFormatters } from "@/components/audio/effect-params/param-definitions";
import { type BranchParams, setBranchParams } from "@/lib/node-graph/branches";
import {
  commitNodeGraph,
  type NodeStore,
  nodeStore,
  snapshotNodeGraph,
} from "@/lib/node-graph/node-store";
import { MAX_EDGE_GAIN } from "@/lib/node-graph/schema";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type FlowEdge,
  type FlowEdgeProps,
  getBezierPath,
} from "./flow-adapter";
import type { BranchEdgeData } from "./flow-elements";
import { keepControlKeys, ModuleKnob, RELEASE_DELAY_MS } from "./module-frame";

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

/** "−6.0 dB · L40 · M · S": what differs from a unity, centred branch. */
export function branchSummary(data: BranchEdgeData): string[] {
  const parts: string[] = [];
  if (data.gain !== 1) {
    parts.push(paramFormatters.linearGain(data.gain));
  }
  if (Math.abs(data.pan) >= 0.05) {
    parts.push(paramFormatters.pan(data.pan));
  }
  if (data.muted) {
    parts.push("M");
  }
  if (data.solo) {
    parts.push("S");
  }
  return parts;
}

/**
 * Gain and pan knobs, then Mute and Solo. A knob turn folds into the next
 * undo step and its release takes it; a toggle is a step of its own.
 */
export function BranchControls({
  edgeId,
  data,
  store = nodeStore,
}: {
  edgeId: string;
  data: Pick<BranchEdgeData, "name" | "gain" | "pan" | "muted" | "solo">;
  store?: NodeStore;
}) {
  const commit = (patch: BranchParams, step: boolean) => {
    commitNodeGraph(
      (graph) => setBranchParams(graph, edgeId, patch),
      store,
      step ? "snapshot" : undefined
    );
  };
  const release = () => {
    setTimeout(() => snapshotNodeGraph(store), RELEASE_DELAY_MS);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself
    <div
      className="nodrag nopan nowheel flex items-start gap-x-2"
      onKeyDown={keepControlKeys}
      onKeyUp={release}
      onPointerUp={release}
    >
      <ModuleKnob
        defaultValue={1}
        format={paramFormatters.linearGain}
        label="Gain"
        max={MAX_EDGE_GAIN}
        min={0}
        name={`${data.name} gain`}
        onChange={(gain) => commit({ gain }, false)}
        value={data.gain}
      />
      <ModuleKnob
        bipolar
        defaultValue={0}
        format={paramFormatters.pan}
        label="Pan"
        max={1}
        min={-1}
        name={`${data.name} pan`}
        onChange={(pan) => commit({ pan }, false)}
        value={data.pan}
      />
      <div className="flex flex-col gap-1 pt-3">
        <Toggle
          aria-label={`Mute ${data.name}`}
          className="h-6 min-w-12 px-2 text-xs"
          onPressedChange={(muted) => commit({ muted }, true)}
          pressed={data.muted}
          size="sm"
          variant="outline"
        >
          Mute
        </Toggle>
        <Toggle
          aria-label={`Solo ${data.name}`}
          className="h-6 min-w-12 px-2 text-xs"
          onPressedChange={(solo) => commit({ solo }, true)}
          pressed={data.solo}
          size="sm"
          variant="outline"
        >
          Solo
        </Toggle>
      </div>
    </div>
  );
}

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
                title={`${described}. Click for gain, pan, mute and solo`}
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
