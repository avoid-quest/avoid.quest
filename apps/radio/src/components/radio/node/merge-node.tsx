/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { cn } from "@avoid.quest/ui/lib/utils";
import { getNodeDefinition } from "@/lib/node-graph/catalogue";
import type { MergeRole } from "@/lib/node-graph/compile";
import { BUS_MERGE_MESSAGE } from "@/lib/node-graph/validate";
import type { FlowNode, FlowNodeProps } from "./flow-adapter";
import type { MergeNodeData } from "./flow-elements";
import { ModuleFrame, ModuleHeader, ModulePorts } from "./module-frame";
import { useNodeActions } from "./node-actions";
import { nodeIcon } from "./node-icons";

/**
 * Merge Node
 *
 * Joins a split's branches back into one (up to eight cables). The badge is
 * the compiler's verdict: `in-lane` when the Merge closes a split inside one
 * station's lane, `bus` when it would sum stations, which waits for buses
 * and so is refused. Per-input levels ride on the branch cables.
 */

export type MergeFlowNode = FlowNode<MergeNodeData, "merge">;

const MAX_INPUTS = getNodeDefinition("merge").ports[0]?.max ?? 8;
/** Room for the title, the badge and the menu. */
const MERGE_WIDTH_PX = 176;

const ROLE_HINTS: Record<MergeRole, string> = {
  bus: BUS_MERGE_MESSAGE,
  "in-lane": "Joins one station's branches, inside its lane",
};

/** The compiler's badge, lowercase sans like the backend badges. */
export function MergeRoleBadge({ role }: { role: MergeRole }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded px-1 py-0.5 font-medium text-[10px] leading-none",
        role === "bus"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground"
      )}
      title={ROLE_HINTS[role]}
    >
      {role}
    </span>
  );
}

export function MergeNodeBody({
  data,
  selected = false,
  onRemove,
}: {
  data: MergeNodeData;
  selected?: boolean;
  onRemove: () => void;
}) {
  const title = getNodeDefinition("merge").name;
  return (
    <ModuleFrame on={false} selected={selected} width={MERGE_WIDTH_PX}>
      <ModuleHeader
        badge={data.role ? <MergeRoleBadge role={data.role} /> : null}
        icon={nodeIcon("merge")}
        on={false}
        onRemove={onRemove}
        title={title}
      />
      <p className="rounded-b-[inherit] border-border/50 border-t bg-muted/30 px-2 py-1.5 text-[10px] text-muted-foreground tabular-nums">
        {data.inputs === 0
          ? "Cable a split's branches here"
          : `${data.inputs} of ${MAX_INPUTS} inputs`}
      </p>
    </ModuleFrame>
  );
}

/** A Merge on the canvas: its body plus its ports. */
export function MergeNode({
  id,
  data,
  selected,
}: FlowNodeProps<MergeFlowNode>) {
  const actions = useNodeActions();
  return (
    <>
      <MergeNodeBody
        data={data}
        onRemove={() => actions.removeNode(id)}
        selected={selected}
      />
      <ModulePorts title={getNodeDefinition("merge").name} type="merge" />
    </>
  );
}
