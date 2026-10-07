/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { useStore } from "@tanstack/react-store";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { getMidiControl } from "@/lib/midi";
import { findPort, getNodeDefinition } from "@/lib/node-graph/catalogue";
import {
  MODULATION_COMMON_FIELDS,
  MODULATION_FIELDS,
} from "@/lib/node-graph/modulation-fields";
import { setModulatorParams } from "@/lib/node-graph/modulation-parameters";
import {
  gateModulator,
  modulationReadouts,
  runModulation,
} from "@/lib/node-graph/modulation-runtime";
import {
  MODULATION_DATA_SCHEMAS,
  type ModulationNodeType,
  type ModulationSpec,
} from "@/lib/node-graph/modulation-schema";
import {
  commitNodeGraph,
  type NodeStore,
  nodeStore,
  snapshotNodeGraph,
} from "@/lib/node-graph/node-store";
import type { FlowNode, FlowNodeProps } from "./flow-adapter";
import { CurveEditor, StepsEditor } from "./modulation-editors";
import {
  controlName,
  ModuleControls,
  ModuleFrame,
  ModuleHeader,
  ModuleKnob,
  ModulePorts,
  ModuleSelect,
  ModuleSwitch,
} from "./module-frame";
import { useNodeActions } from "./node-actions";
import { nodeIcon } from "./node-icons";

export const CONTROL_NODE_WIDTH = 320;
type ControlFlowNode = FlowNode<ModulationSpec["data"], ModulationNodeType>;

function ModulationMonitor({ id, bipolar }: { id: string; bipolar: boolean }) {
  const value = useStore(modulationReadouts, (state) => state.values[id] ?? 0);
  const status = useStore(modulationReadouts, (state) => state.status);
  const error = useStore(modulationReadouts, (state) => state.error);
  const backend = useStore(modulationReadouts, (state) => state.backends[id]);
  const nativeWarning = useStore(
    modulationReadouts,
    (state) => state.nativeWarning
  );
  const samples = useRef<number[]>([]);
  const line = useRef<SVGPolylineElement>(null);
  useEffect(() => {
    samples.current.push(value);
    if (samples.current.length > 64) {
      samples.current.shift();
    }
    line.current?.setAttribute(
      "points",
      samples.current
        .map(
          (sample, index) =>
            `${(index / 63) * 288},${36 - (bipolar ? (sample + 1) / 2 : sample) * 32}`
        )
        .join(" ")
    );
  }, [value, bipolar]);
  return (
    <div className="w-full px-2 pb-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          Output{" "}
          <output
            aria-label="Modulation output"
            className="font-mono text-foreground"
          >
            {value.toFixed(3)}
          </output>
        </span>
        <span
          title={
            nativeWarning ??
            (backend === "unavailable"
              ? "unavailable on Safari/fallback"
              : `${backend ?? "Starting"} source`)
          }
        >
          {backend}
        </span>
        <Button onClick={runModulation} size="sm" variant="ghost">
          {status === "running" ? "Running" : "Run"}
        </Button>
      </div>
      <svg
        aria-label="Live modulation trace"
        className="h-10 w-full rounded bg-muted/30 text-primary"
        role="img"
        viewBox="0 0 288 40"
      >
        <title>Live modulation output</title>
        <path
          d={`M0 ${bipolar ? 20 : 36}H288`}
          opacity={0.2}
          stroke="currentColor"
        />
        <polyline
          fill="none"
          ref={line}
          stroke="currentColor"
          strokeWidth={1.5}
        />
      </svg>
      {error ? (
        <p className="mt-1 break-words text-destructive text-xs">{error}</p>
      ) : null}
    </div>
  );
}

function ModulationGate({ id, hold }: { id: string; hold: boolean }) {
  const release = () => gateModulator(id, false);
  const keyGate = (event: KeyboardEvent, on: boolean) => {
    if (event.key !== " " && event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    if (!(on && event.repeat)) {
      gateModulator(id, on);
    }
  };
  return (
    <div className="flex items-center gap-2 px-2 pb-2">
      <Button
        onBlur={release}
        onKeyDown={(event) => keyGate(event, true)}
        onKeyUp={(event) => keyGate(event, false)}
        onLostPointerCapture={release}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          gateModulator(id, true);
        }}
        onPointerUp={release}
        size="sm"
        variant="outline"
      >
        {hold ? "Hold gate" : "Trigger / reset"}
      </Button>
      <span className="text-[10px] text-muted-foreground">
        or connect Clock / MIDI gate
      </span>
    </div>
  );
}

export function ModulationControls({
  node,
  store = nodeStore,
}: {
  node: ModulationSpec;
  store?: NodeStore;
}) {
  const title = getNodeDefinition(node.type).name;
  const values = node.data as Record<string, unknown>;
  const commit = (patch: Record<string, unknown>, step = false) =>
    commitNodeGraph(
      (graph) => setModulatorParams(graph, node.id, patch),
      store,
      step ? "snapshot" : undefined
    );
  const fields = [...MODULATION_FIELDS[node.type], ...MODULATION_COMMON_FIELDS];
  const gated = findPort(node.type, "in", "control", "gate") !== undefined;
  return (
    <>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-3 px-2 py-2">
        {fields.map((field) => {
          const name = controlName(title, field.label);
          if (field.kind === "select") {
            return (
              <ModuleSelect
                key={field.key}
                label={field.label}
                name={name}
                onChange={(value) => commit({ [field.key]: value }, true)}
                options={field.options}
                value={String(values[field.key])}
              />
            );
          }
          if (field.kind === "toggle") {
            return (
              <ModuleSwitch
                checked={Boolean(values[field.key])}
                key={field.key}
                label={field.label}
                name={name}
                onChange={(value) => commit({ [field.key]: value }, true)}
              />
            );
          }
          return (
            <ModuleKnob
              bipolar={field.min < 0}
              format={(value) =>
                field.step === 1
                  ? String(Math.round(value))
                  : value.toFixed(value < 1 ? 3 : 2)
              }
              key={field.key}
              label={field.label}
              max={field.max}
              midiTargetId={`node:${node.id}:${field.key}`}
              min={field.min}
              name={name}
              onChange={(value) => commit({ [field.key]: value })}
              scale={field.scale}
              step={field.step}
              value={Number(values[field.key])}
            />
          );
        })}
      </div>
      {gated ? (
        <ModulationGate
          hold={node.type === "envelope" || node.type === "multiEnvelope"}
          id={node.id}
        />
      ) : null}
      {node.type === "steps" ? (
        <StepsEditor
          onChange={(steps) => commit({ values: steps })}
          values={node.data.values}
        />
      ) : null}
      {node.type === "curve" || node.type === "multiEnvelope" ? (
        <CurveEditor
          fixed={node.type === "multiEnvelope"}
          onChange={(points) => commit({ points })}
          points={node.data.points}
        />
      ) : null}
      {node.type === "midiIn" ? (
        <div className="px-2 pb-2">
          <Button
            onClick={() => {
              runModulation();
              getMidiControl().connect();
            }}
            size="sm"
            variant="outline"
          >
            Connect MIDI
          </Button>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Channels are 0–15. MIDI settings must be enabled.
          </p>
        </div>
      ) : null}
      {node.type === "follower" ? (
        <p className="px-2 pb-2 text-[10px] text-muted-foreground">
          Connect audio to In. Detects stereo energy at the connected routing
          tap.
        </p>
      ) : null}
      {"sync" in node.data ? (
        <p className="px-2 pb-2 text-[10px] text-muted-foreground">
          Free Hz adds to Sync. Set Free Hz to 0 for tempo-only timing.
        </p>
      ) : null}
      <ModulationMonitor bipolar={node.data.bipolar} id={node.id} />
    </>
  );
}

export function ControlNode({
  id,
  type,
  data,
  selected,
}: FlowNodeProps<ControlFlowNode>) {
  const actions = useNodeActions();
  const node = { data, id, type } as ModulationSpec;
  const title = getNodeDefinition(type).name;
  return (
    <>
      <ModuleFrame
        on={data.enabled}
        selected={selected}
        width={CONTROL_NODE_WIDTH}
      >
        <ModuleHeader
          enabled={data.enabled}
          icon={nodeIcon(type)}
          on={data.enabled}
          onEnabledChange={(enabled) =>
            commitNodeGraph(
              (graph) => setModulatorParams(graph, id, { enabled }),
              nodeStore,
              "snapshot"
            )
          }
          onInspect={() => actions.inspectNode(id)}
          onRemove={() => actions.removeNode(id)}
          onReset={() =>
            commitNodeGraph(
              (graph) =>
                setModulatorParams(
                  graph,
                  id,
                  MODULATION_DATA_SCHEMAS[type].parse({})
                ),
              nodeStore,
              "snapshot"
            )
          }
          title={title}
        />
        <ModuleControls onRelease={() => snapshotNodeGraph()}>
          <div className="w-full">
            <ModulationControls node={node} />
          </div>
        </ModuleControls>
      </ModuleFrame>
      <ModulePorts title={title} type={type} />
    </>
  );
}
