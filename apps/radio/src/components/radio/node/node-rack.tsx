import { Badge } from "@avoid.quest/ui/components/badge";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useId, useState } from "react";
import type { Radio } from "@/lib/audio";
import { isSessionRadio } from "@/lib/hooks/use-session-radios";
import { getNodeDefinition } from "@/lib/node-graph/catalogue";
import {
  type CompileEnv,
  compile,
  type EnginePlan,
  type LanePlan,
} from "@/lib/node-graph/compile";
import type { GraphNode, NodeGraph } from "@/lib/node-graph/schema";
import { detectNodePlaybackEnv, getNodePlayback } from "@/lib/node-playback";
import { EmptyHint } from "../empty-hint";
import { InlineError } from "../inline-error";
import { RadioItemActions } from "../radio-item-actions";
import {
  StationRowSubtitle,
  StationRowText,
  stationRowClassName,
} from "../station-row";
import { BackendBadge } from "./backend-badge";
import { useNodeActions } from "./node-actions";
import { type NodeLaneControls, NodeSourceRow } from "./node-source-row";

type RackGroup = { key: string; title: string; lanes: LanePlan[] };

const UNWIRED_GROUP = "unwired";

/**
 * Lanes grouped by where their audio goes, one row per lane: every lane
 * that reaches the same outputs shares a group, and a lane with no cable
 * out is listed as not connected (it plays silent).
 */
function groupLanes(plan: EnginePlan): RackGroup[] {
  const groups = new Map<string, RackGroup>();
  for (const lane of plan.lanes.values()) {
    const sinkIds = [
      ...new Set(
        [...plan.edges.values()]
          .filter((edge) => edge.from.id === lane.id)
          .map((edge) => edge.to.id)
      ),
    ].sort();
    const key = sinkIds.length > 0 ? sinkIds.join(" ") : UNWIRED_GROUP;
    const names = sinkIds.map((id) => {
      const sink = plan.sinks.get(id);
      return sink ? getNodeDefinition(sink.type).name : id;
    });
    const group = groups.get(key) ?? {
      key,
      lanes: [],
      title:
        key === UNWIRED_GROUP
          ? "Not connected"
          : `Direct to ${names.join(" and ")}`,
    };
    group.lanes.push(lane);
    groups.set(key, group);
  }
  // Wired groups first; the unwired one last.
  return [...groups.values()].sort(
    (left, right) =>
      Number(left.key === UNWIRED_GROUP) - Number(right.key === UNWIRED_GROUP)
  );
}

function RackSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 px-2.5">
        <h3 className="font-medium text-xs" id={headingId}>
          {title}
        </h3>
        {hint ? (
          <span className="truncate text-muted-foreground text-xs">{hint}</span>
        ) : null}
      </div>
      <ul aria-labelledby={headingId} className="flex flex-col gap-1">
        {children}
      </ul>
    </section>
  );
}

/**
 * The FX lowered into a lane, and its backend badge: `compat` or
 * `bypassed`, nothing while it runs as planned.
 */
function LaneChain({
  lane,
  nodesById,
}: {
  lane: LanePlan;
  nodesById: Map<string, GraphNode>;
}) {
  const fx = lane.nodes
    .slice(1)
    .map((id) => nodesById.get(id))
    .filter((node): node is GraphNode => Boolean(node));
  if (fx.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-1 pl-9">
      {fx.map((node) => (
        <Badge
          className="font-normal text-[10px]"
          key={node.id}
          variant="outline"
        >
          {getNodeDefinition(node.type).name}
        </Badge>
      ))}
      <BackendBadge nodeId={lane.id} />
    </div>
  );
}

/** A hidden saved station keeps its node but has no lane; Show restores it. */
function HiddenStationRow({ radio }: { radio: Radio }) {
  const actions = useNodeActions();
  return (
    <li
      className={cn(
        stationRowClassName,
        "opacity-60",
        isSessionRadio(radio) && "border-l-2 border-l-[#00d084]/40"
      )}
    >
      <StationRowText title={radio.name}>
        <StationRowSubtitle>Hidden. Show it to play here.</StationRowSubtitle>
      </StationRowText>
      <RadioItemActions
        onDelete={actions.handleDeleteRadio}
        onEdit={actions.handleEditRadio}
        onSave={actions.handleSaveSessionRadio}
        onToggle={actions.handleToggleRadio}
        radio={radio}
      />
    </li>
  );
}

/**
 * The compiled patch as a list: each lane with its station, play, volume
 * and FX, grouped by where it goes. With no canvas at all this is the
 * complete path through the patch.
 */
export function NodeRack({
  graph,
  controls = getNodePlayback(),
  env,
}: {
  graph: NodeGraph;
  controls?: NodeLaneControls;
  /** Defaults to this device, read once. */
  env?: CompileEnv;
}) {
  const actions = useNodeActions();
  const [detectedEnv] = useState(detectNodePlaybackEnv);
  const plan = compile(graph, env ?? detectedEnv);
  const groups = groupLanes(plan);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const hidden = graph.nodes.flatMap((node) =>
    node.type === "station" && node.data.radio?.enabled === false
      ? [{ id: node.id, radio: node.data.radio as Radio }]
      : []
  );

  if (groups.length === 0 && hidden.length === 0) {
    return <EmptyHint className="py-10">Search to add a station</EmptyHint>;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <RackSection
          hint={group.key === UNWIRED_GROUP ? "Silent until cabled" : undefined}
          key={group.key}
          title={group.title}
        >
          {group.lanes.map((lane) => {
            const radio = lane.radio as Radio;
            return (
              <li key={lane.id}>
                <NodeSourceRow
                  actions={
                    <RadioItemActions
                      onDelete={actions.handleDeleteRadio}
                      onEdit={actions.handleEditRadio}
                      onSave={actions.handleSaveSessionRadio}
                      onToggle={actions.handleToggleRadio}
                      radio={radio}
                    />
                  }
                  controls={controls}
                  muted={lane.muted}
                  nodeId={lane.id}
                  radio={radio}
                  volume={lane.volume}
                >
                  <LaneChain lane={lane} nodesById={nodesById} />
                </NodeSourceRow>
              </li>
            );
          })}
        </RackSection>
      ))}
      {hidden.length > 0 ? (
        <RackSection title="Hidden">
          {hidden.map((station) => (
            <HiddenStationRow key={station.id} radio={station.radio} />
          ))}
        </RackSection>
      ) : null}
      {plan.issues.length > 0 ? (
        <div className="flex flex-col gap-1 px-2.5">
          {plan.issues.map((issue) => (
            <InlineError key={`${issue.target}:${issue.id}:${issue.code}`}>
              {issue.message}
            </InlineError>
          ))}
        </div>
      ) : null}
    </div>
  );
}
