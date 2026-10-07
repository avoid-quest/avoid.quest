/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { getNodeDefinition } from "@/lib/node-graph/catalogue";
import type { MergeRole } from "@/lib/node-graph/compile";
import type { FlowNode, FlowNodeProps } from "./flow-adapter";
import type { MergeNodeData } from "./flow-elements";
import { ModuleFrame, ModuleHeader, ModulePorts } from "./module-frame";
import { useNodeActions } from "./node-actions";
import { nodeIcon } from "./node-icons";

/**
 * Merge Node
 *
 * Joins cables into one. The badge is the compiler's verdict: `closes`
 * when the Merge joins a split's branches back inside one chain, `sum` when
 * it mixes cables from different places, e.g. stations into shared FX.
 * Per-input levels ride on the cables.
 */

export type MergeFlowNode = FlowNode<MergeNodeData, "merge">;

/** Room for the title, the badge and the menu. */
export const MERGE_WIDTH_PX = 176;

const ROLE_HINTS: Record<MergeRole, string> = {
  closes: "Joins a split's branches back into one",
  sum: "Mixes its inputs into one shared signal",
};

/** The compiler's badge, lowercase sans like the backend badges. */
export function MergeRoleBadge({ role }: { role: MergeRole }) {
  return (
    <span
      className="inline-flex shrink-0 rounded bg-muted px-1 py-0.5 font-medium text-[10px] text-muted-foreground leading-none"
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
          : `${data.inputs} ${data.inputs === 1 ? "input" : "inputs"}`}
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
