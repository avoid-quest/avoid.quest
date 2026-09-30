/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { paramFormatters } from "@/components/audio/effect-params/param-definitions";
import {
  NATIVE_PARAM_RANGES,
  type NativeParamRange,
  nodeMidiTargetPrefix,
} from "@/lib/midi/node-midi-actions";
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

const FORMATS: Record<NativeParamRange["key"], (value: number) => string> = {
  frequency: paramFormatters.frequency,
  gainDb: paramFormatters.gain,
  pan: paramFormatters.pan,
  Q: paramFormatters.q,
};

const DEFAULTS: Record<NativeParamRange["key"], number> = {
  frequency: 1000,
  gainDb: 0,
  pan: 0,
  Q: 1,
};

/**
 * A node's type select, if it has one, then a knob per native param, each
 * MIDI-learnable as `node:<nodeId>:<key>`. The node body and the inspector
 * share them.
 */
export function NativeControls({ node, title, onChange, onStep }: Controls) {
  const name = (label: string) => controlName(title, label);
  const data = node.data as Record<string, unknown>;
  return (
    <>
      {node.type === "filter" ? (
        <ModuleSelect
          label="Type"
          name={name("Type")}
          onChange={(type) => onStep({ type: type as "lowpass" | "highpass" })}
          options={FILTER_TYPES}
          value={node.data.type}
        />
      ) : null}
      {NATIVE_PARAM_RANGES[node.type].map((range) => (
        <ModuleKnob
          bipolar={range.min < 0 && range.max > 0}
          defaultValue={DEFAULTS[range.key]}
          format={FORMATS[range.key]}
          key={range.key}
          label={range.label}
          max={range.max}
          midiTargetId={`${nodeMidiTargetPrefix(node.id)}:${range.key}`}
          min={range.min}
          name={name(range.label)}
          onChange={(value) => onChange({ [range.key]: value })}
          scale={range.scale}
          step={range.step}
          value={data[range.key] as number}
        />
      ))}
    </>
  );
}

const COLUMNS: Record<NativeNodeType, number> = { filter: 3, gain: 1, pan: 1 };

export type NativeNodeBodyProps = {
  node: NativeNode;
  selected?: boolean;
  onChange: (patch: NativeParams) => void;
  onStep: (patch: NativeParams) => void;
  onRelease: () => void;
  onRemove: () => void;
  /** Opens the node in the inspector. */
  onInspect?: () => void;
};

export function NativeNodeBody({
  node,
  selected = false,
  onChange,
  onStep,
  onRelease,
  onRemove,
  onInspect,
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
        onInspect={onInspect}
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
        onInspect={() => actions.inspectNode(id)}
        onRelease={() => snapshotNodeGraph()}
        onRemove={() => actions.removeNode(id)}
        onStep={(patch) => commit(patch, true)}
        selected={selected}
      />
      <ModulePorts title={getNodeDefinition(type).name} type={type} />
    </>
  );
}

/** How wide a Filter, Pan or Gain node body draws. */
export function nativeNodeWidth(type: NativeNodeType): number {
  return moduleWidth(COLUMNS[type], MIN_NATIVE_COLUMNS);
}
