/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes handlers */
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@avoid.quest/ui/components/popover";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useStore } from "@tanstack/react-store";
import {
  controlDepth,
  modulationParameters,
} from "@/lib/node-graph/modulation-parameters";
import { nodeStore } from "@/lib/node-graph/node-store";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type FlowEdge,
  type FlowEdgeProps,
  getBezierPath,
} from "./flow-adapter";
import { type ControlEdgeData, unappliedTag } from "./flow-elements";
import { ModulationCableControls } from "./modulation-cables";
import { keepControlKeys } from "./module-frame";

type ControlFlowEdge = FlowEdge<ControlEdgeData, "control">;

/**
 * A modulation cable: a dashed wire in the primary colour, its target
 * parameter and depth on a tag that opens its controls. One the runtime
 * doesn't apply, such as into an effect on the compatibility engine, fades
 * like a muted one and its tag says "not applied", titled with why.
 */
export function ControlEdge(props: FlowEdgeProps<ControlFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath(props);
  const graph = useStore(nodeStore, (state) => state.graph);
  const edge = graph?.edges.find((entry) => entry.id === props.id);
  const target = graph?.nodes.find((node) => node.id === props.target);
  const parameters =
    target && edge?.targetHandle === "in:control:parameter"
      ? modulationParameters(target)
      : [];
  const parameter = parameters.find(
    (entry) => entry.key === (edge?.parameter ?? parameters[0]?.key)
  );
  const label =
    parameter?.label ??
    (edge?.targetHandle.endsWith(":gate") ? "Gate" : "Control");
  const unapplied = props.data?.unapplied ?? null;
  return (
    <>
      <BaseEdge
        id={props.id}
        interactionWidth={props.interactionWidth}
        path={path}
        style={{
          ...props.style,
          opacity: edge?.muted || (unapplied && !unapplied.partly) ? 0.35 : 0.8,
          stroke: "var(--primary)",
          strokeDasharray: "4 4",
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <Popover>
            <PopoverTrigger asChild>
              <button
                aria-label={`Edit ${label} modulation${unapplied ? `, ${unappliedTag(unapplied)}: ${unapplied.why}` : ""}`}
                className={cn(
                  "rounded border bg-background px-1.5 py-0.5 text-[10px] shadow-sm",
                  unapplied
                    ? "border-border text-muted-foreground"
                    : "border-primary/30 text-primary"
                )}
                title={unapplied?.why}
                type="button"
              >
                {label} · {Math.round((edge ? controlDepth(edge) : 1) * 100)}%
                {unapplied ? ` · ${unappliedTag(unapplied)}` : null}
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-64 p-3"
              onKeyDown={keepControlKeys}
              side="top"
            >
              <ModulationCableControls edgeId={props.id} />
            </PopoverContent>
          </Popover>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
