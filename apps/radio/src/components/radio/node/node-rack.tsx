/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */

import { Badge } from "@avoid.quest/ui/components/badge";
import { Button } from "@avoid.quest/ui/components/button";
import { cn } from "@avoid.quest/ui/lib/utils";
import { KeyRoundIcon, ListMusicIcon } from "lucide-react";
import { useId, useState } from "react";
import type { Radio } from "@/lib/audio";
import { isSessionRadio } from "@/lib/hooks/use-session-radios";
import { getNodeDefinition } from "@/lib/node-graph/catalogue";
import {
  type CompileEnv,
  type EnginePlan,
  idleKeys,
  type LanePlan,
} from "@/lib/node-graph/compile";
import { compiledPlan } from "@/lib/node-graph/compiled-plan";
import { nodeLabel } from "@/lib/node-graph/describe";
import {
  type GraphNode,
  isStripSource,
  type NodeGraph,
} from "@/lib/node-graph/schema";
import { isTrackRadio } from "@/lib/node-graph/sources";
import { parseHandleId } from "@/lib/node-graph/validate";
import { detectNodePlaybackEnv, getNodePlayback } from "@/lib/node-playback";
import { isDeviceInputMetadata } from "@/lib/platform-types";
import { EmptyHint } from "../empty-hint";
import { InlineError } from "../inline-error";
import { RadioItemActions } from "../radio-item-actions";
import {
  StationRowSubtitle,
  StationRowText,
  stationRowClassName,
} from "../station-row";
import { BackendBadge } from "./backend-badge";
import { inputFeedback } from "./flow-elements";
import { useNodeActions } from "./node-actions";
import { isInspectable, sourceTracklist } from "./node-inspector";
import {
  type NodeLaneControls,
  NodeSourceRow,
  RepickFileRow,
  repickFiles,
} from "./node-source-row";
import { NodeCompactStrip } from "./node-source-strip";

type RackGroup = { key: string; title: string; lanes: LanePlan[] };

const UNWIRED_GROUP = "unwired";

/**
 * Lanes grouped by where their audio goes, one row per lane: every lane
 * that reaches the same outputs shares a group, named for them (Speakers,
 * an Output device by its device), and a lane with no cable out is listed
 * as not connected (it plays silent).
 */
function groupLanes(
  plan: EnginePlan,
  nodesById: ReadonlyMap<string, GraphNode>
): RackGroup[] {
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
      return sink ? nodeLabel(nodesById.get(id)) : id;
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

/** Shared processors are displayed in every source path that reaches them. */
function rackLane(plan: EnginePlan, lane: LanePlan): LanePlan {
  if (!plan.patch) {
    return lane;
  }
  const nodes = [lane.id];
  const seen = new Set(nodes);
  for (const id of nodes) {
    for (const edge of plan.patch.edges.values()) {
      if (
        edge.source !== id ||
        !edge.targetHandle.startsWith("in:audio:") ||
        seen.has(edge.target)
      ) {
        continue;
      }
      seen.add(edge.target);
      const target = plan.patch.nodes.get(edge.target);
      if (
        target &&
        getNodeDefinition(target.type).category !== "output" &&
        target.type !== "follower"
      ) {
        nodes.push(target.id);
      }
    }
  }
  return { ...lane, nodes };
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
 * The station keying each FX, by FX node id, for the key cables the plan
 * keys with: the same verdict the canvas's idle key tags show, so a key
 * on a switched-off FX, or one the runtime won't bind, names no station.
 */
function keyingStations(
  graph: NodeGraph,
  plan: EnginePlan
): Map<string, string> {
  const idle = idleKeys(graph, plan);
  const stationOf = new Map<string, string>();
  for (const lane of plan.lanes.values()) {
    for (const id of lane.nodes) {
      stationOf.set(id, lane.radio.name);
    }
  }
  const keyed = new Map<string, string>();
  for (const edge of graph.edges) {
    const station =
      stationOf.get(edge.source) ??
      nodeLabel(graph.nodes.find((node) => node.id === edge.source));
    if (
      station &&
      parseHandleId(edge.targetHandle)?.kind === "sidechain" &&
      !idle.has(edge.id)
    ) {
      keyed.set(
        edge.target,
        [keyed.get(edge.target), station].filter(Boolean).join(", ")
      );
    }
  }
  return keyed;
}

/**
 * The FX lowered into a lane as chips that open the inspector, and its
 * backend badge: `compat` or `bypassed`, nothing while it runs as planned.
 */
function LaneChain({
  lane,
  nodesById,
  keyedBy: keyers,
}: {
  lane: LanePlan;
  nodesById: Map<string, GraphNode>;
  /** The station keying each FX whose key cable keys, by FX node id. */
  keyedBy: ReadonlyMap<string, string>;
}) {
  const actions = useNodeActions();
  const fx = lane.nodes
    .slice(1)
    .map((id) => nodesById.get(id))
    .filter((node): node is GraphNode => Boolean(node));
  if (fx.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-1 pl-9">
      {fx.map((node) => {
        const { name } = getNodeDefinition(node.type);
        // A Merge has nothing to set, so it stays a plain tag.
        if (!isInspectable(node)) {
          return (
            <Badge
              className="font-normal text-[10px]"
              key={node.id}
              variant="outline"
            >
              {name}
            </Badge>
          );
        }
        const keyedBy = keyers.get(node.id);
        return (
          <Badge
            asChild
            className="cursor-pointer font-normal text-[10px] hover:bg-accent hover:text-accent-foreground"
            key={node.id}
            variant="outline"
          >
            <button
              aria-label={
                keyedBy
                  ? `${name} settings, keyed by ${keyedBy}`
                  : `${name} settings`
              }
              data-inspect-node={node.id}
              onClick={() => actions.inspectNode(node.id)}
              title={keyedBy ? `Keyed by ${keyedBy}` : undefined}
              type="button"
            >
              {name}
              {keyedBy ? (
                <span className="flex min-w-0 items-center gap-0.5 text-muted-foreground">
                  <KeyRoundIcon aria-hidden className="size-2.5" />
                  <span className="max-w-24 truncate">{keyedBy}</span>
                </span>
              ) : null}
            </button>
          </Badge>
        );
      })}
      <BackendBadge nodeId={lane.id} />
    </div>
  );
}

/** A Track's or File's tracklist opens in the inspector. */
function TracksButton({ nodeId, name }: { nodeId: string; name: string }) {
  const actions = useNodeActions();
  return (
    <Button
      aria-label={`Tracks of ${name}`}
      className="size-7 shrink-0 text-muted-foreground"
      data-inspect-node={nodeId}
      onClick={() => actions.inspectNode(nodeId)}
      size="icon"
      title="Tracks"
      variant="ghost"
    >
      <ListMusicIcon className="size-3.5" />
    </Button>
  );
}

/** A hidden saved station keeps its node but has no lane; Show restores it. */
function HiddenStationRow({ radio, nodeId }: { radio: Radio; nodeId: string }) {
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
      <Button
        aria-label={`${radio.name} settings`}
        data-inspect-node={nodeId}
        onClick={() => actions.inspectNode(nodeId)}
        size="sm"
        variant="outline"
      >
        Settings
      </Button>
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
 * The compiled patch as a list: each lane with its station, play, volume,
 * compact channel strip and FX, grouped by where it goes. With no canvas at all this is the
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
  const plan = compiledPlan(graph, env ?? detectedEnv);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const groups = groupLanes(plan, nodesById);
  const keyedBy = keyingStations(graph, plan);
  const hidden = graph.nodes.flatMap((node) =>
    node.type === "station" && node.data.radio?.enabled === false
      ? [{ id: node.id, radio: node.data.radio as Radio }]
      : []
  );
  const repick = repickFiles(graph);

  const listed = new Set([
    ...[...plan.lanes.values()].flatMap((lane) => rackLane(plan, lane).nodes),
    ...hidden.map((node) => node.id),
    ...repick.map((node) => node.id),
  ]);
  const otherModules = graph.nodes.filter((node) => !listed.has(node.id));

  return (
    <div className="flex flex-col gap-4">
      {graph.nodes.every(
        (node) => getNodeDefinition(node.type).category === "output"
      ) ? (
        <EmptyHint className="py-10">Search to add a station</EmptyHint>
      ) : null}
      {groups.map((group) => (
        <RackSection
          hint={group.key === UNWIRED_GROUP ? "Silent until cabled" : undefined}
          key={group.key}
          title={group.title}
        >
          {group.lanes.map((lane) => {
            const radio = lane.radio as Radio;
            // An Audio input, Track or File is no saved station: it has no
            // station menu. An album or playlist opens its tracklist.
            const isInput = isDeviceInputMetadata(radio.platformMetadata);
            const node = nodesById.get(lane.id);
            let actionsSlot: React.ReactNode = null;
            if (isTrackRadio(radio)) {
              actionsSlot = sourceTracklist(node) ? (
                <TracksButton name={radio.name} nodeId={lane.id} />
              ) : null;
            } else if (!isInput) {
              actionsSlot = (
                <RadioItemActions
                  onDelete={actions.handleDeleteRadio}
                  onEdit={actions.handleEditRadio}
                  onSave={actions.handleSaveSessionRadio}
                  onToggle={actions.handleToggleRadio}
                  radio={radio}
                />
              );
            }
            return (
              <li key={lane.id}>
                <NodeSourceRow
                  actions={actionsSlot}
                  controls={controls}
                  feedback={inputFeedback(graph, lane.id)}
                  muted={lane.muted}
                  nodeId={lane.id}
                  radio={radio}
                  strip={
                    isStripSource(node) ? (
                      <NodeCompactStrip
                        muted={lane.muted}
                        nodeId={lane.id}
                        onInspect={() => actions.inspectNode(lane.id)}
                        onToggleMute={() => controls.toggleMute(lane.id)}
                        strip={node.data.strip}
                        target={radio.name}
                      />
                    ) : null
                  }
                  volume={lane.volume}
                >
                  <LaneChain
                    keyedBy={keyedBy}
                    lane={rackLane(plan, lane)}
                    nodesById={nodesById}
                  />
                </NodeSourceRow>
              </li>
            );
          })}
        </RackSection>
      ))}
      {repick.length > 0 ? (
        <RackSection title="Pick again">
          {repick.map((file) => (
            <RepickFileRow
              inspect
              key={file.id}
              nodeId={file.id}
              radio={file.radio}
            />
          ))}
        </RackSection>
      ) : null}
      {hidden.length > 0 ? (
        <RackSection title="Hidden">
          {hidden.map((station) => (
            <HiddenStationRow
              key={station.id}
              nodeId={station.id}
              radio={station.radio}
            />
          ))}
        </RackSection>
      ) : null}
      {otherModules.length > 0 ? (
        <RackSection title="Other modules">
          {otherModules.map((node) => (
            <li className={stationRowClassName} key={node.id}>
              <StationRowText title={nodeLabel(node)} />
              {isInspectable(node) ? (
                <Button
                  aria-label={`${nodeLabel(node)} settings`}
                  data-inspect-node={node.id}
                  onClick={() => actions.inspectNode(node.id)}
                  size="sm"
                  variant="outline"
                >
                  Settings
                </Button>
              ) : null}
            </li>
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
