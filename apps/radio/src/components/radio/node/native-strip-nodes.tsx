/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { paramFormatters } from "@/components/audio/effect-params/param-definitions";
import { getNodeDefinition } from "@/lib/node-graph/catalogue";
import {
  type NativeParams,
  setNativeParams,
} from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  nodeStore,
  snapshotNodeGraph,
} from "@/lib/node-graph/node-store";
import { type GraphNode, graphNodeSchema } from "@/lib/node-graph/schema";
import type { FlowNode, FlowNodeProps } from "./flow-adapter";
import {
  controlName,
  ModuleControls,
  ModuleFrame,
  ModuleHeader,
  ModuleKnob,
  ModulePorts,
  ModuleSelect,
  moduleWidth,
} from "./module-frame";
import { useNodeActions } from "./node-actions";
import { nodeIcon } from "./node-icons";

/**
 * Native Strip Nodes
 *
 * Filter, Pan and Gain: no effects runtime, so no enable switch and no
 * backend badge. Filter and Pan land on the lane's own BiquadFilter and
 * StereoPanner right after the station; Gain is a level trim on the path.
 */

export type NativeNodeType = "filter" | "pan" | "gain";
type NativeNode = Extract<GraphNode, { type: NativeNodeType }>;
export type NativeFlowNode = FlowNode<NativeNode["data"], NativeNodeType>;

/** A short header needs less room than an effect's switch and badge. */
const MIN_NATIVE_COLUMNS = 2;

const FILTER_TYPES = [
  { label: "Low-pass", short: "Low", value: "lowpass" },
  { label: "High-pass", short: "High", value: "highpass" },
] as const;

function defaultsOf(type: NativeNodeType): NativeParams {
  return graphNodeSchema.parse({
    data: {},
    id: "defaults",
    position: { x: 0, y: 0 },
    type,
  }).data as NativeParams;
}

type Controls = {
  node: NativeNode;
  title: string;
  onChange: (patch: NativeParams) => void;
  onStep: (patch: NativeParams) => void;
};

function NativeControls({ node, title, onChange, onStep }: Controls) {
  const name = (label: string) => controlName(title, label);
  switch (node.type) {
    case "filter":
      return (
        <>
          <ModuleSelect
            label="Type"
            name={name("Type")}
            onChange={(type) =>
              onStep({ type: type as "lowpass" | "highpass" })
            }
            options={FILTER_TYPES}
            value={node.data.type}
          />
          <ModuleKnob
            defaultValue={1000}
            format={paramFormatters.frequency}
            label="Cutoff"
            max={20_000}
            min={20}
            name={name("Cutoff")}
            onChange={(frequency) => onChange({ frequency })}
            scale="log"
            step={1}
            value={node.data.frequency}
          />
          <ModuleKnob
            defaultValue={1}
            format={paramFormatters.q}
            label="Q"
            max={10}
            min={0.1}
            name={name("Q")}
            onChange={(Q) => onChange({ Q })}
            scale="log"
            value={node.data.Q}
          />
        </>
      );
    case "pan":
      return (
        <ModuleKnob
          bipolar
          defaultValue={0}
          format={paramFormatters.pan}
          label="Pan"
          max={1}
          min={-1}
          name={name("Pan")}
          onChange={(pan) => onChange({ pan })}
          value={node.data.pan}
        />
      );
    case "gain":
      return (
        <ModuleKnob
          bipolar
          defaultValue={0}
          format={paramFormatters.gain}
          label="Gain"
          max={12}
          min={-40}
          name={name("Gain")}
          onChange={(gainDb) => onChange({ gainDb })}
          step={0.1}
          value={node.data.gainDb}
        />
      );
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

const COLUMNS: Record<NativeNodeType, number> = { filter: 3, gain: 1, pan: 1 };

export type NativeNodeBodyProps = {
  node: NativeNode;
  selected?: boolean;
  onChange: (patch: NativeParams) => void;
  onStep: (patch: NativeParams) => void;
  onRelease: () => void;
  onRemove: () => void;
};

export function NativeNodeBody({
  node,
  selected = false,
  onChange,
  onStep,
  onRelease,
  onRemove,
}: NativeNodeBodyProps) {
  const title = getNodeDefinition(node.type).name;
  return (
    <ModuleFrame
      on={false}
      selected={selected}
      width={moduleWidth(COLUMNS[node.type], MIN_NATIVE_COLUMNS)}
    >
      <ModuleHeader
        icon={nodeIcon(node.type)}
        on={false}
        onRemove={onRemove}
        onReset={() => onStep(defaultsOf(node.type))}
        title={title}
      />
      <ModuleControls onRelease={onRelease}>
        <NativeControls
          node={node}
          onChange={onChange}
          onStep={onStep}
          title={title}
        />
      </ModuleControls>
    </ModuleFrame>
  );
}

/** A Filter, Pan or Gain node on the canvas: its body plus its ports. */
export function NativeStripNode({
  id,
  type,
  data,
  selected,
  positionAbsoluteX,
  positionAbsoluteY,
}: FlowNodeProps<NativeFlowNode>) {
  const actions = useNodeActions();
  const node = {
    data,
    id,
    position: { x: positionAbsoluteX, y: positionAbsoluteY },
    type,
  } as NativeNode;
  const commit = (patch: NativeParams, step: boolean) => {
    commitNodeGraph(
      (graph) => setNativeParams(graph, id, patch),
      nodeStore,
      step ? "snapshot" : undefined
    );
  };
  return (
    <>
      <NativeNodeBody
        node={node}
        onChange={(patch) => commit(patch, false)}
        onRelease={() => snapshotNodeGraph()}
        onRemove={() => actions.removeNode(id)}
        onStep={(patch) => commit(patch, true)}
        selected={selected}
      />
      <ModulePorts title={getNodeDefinition(type).name} type={type} />
    </>
  );
}
