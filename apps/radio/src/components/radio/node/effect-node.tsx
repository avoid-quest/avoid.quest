/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { useStore } from "@tanstack/react-store";
import type { ReactNode } from "react";
import {
  EFFECT_LAYOUTS,
  shortLabel,
} from "@/components/audio/effect-params/effect-layouts";
import { formatParam } from "@/components/audio/effect-params/param-definitions";
import type { EffectConfig, EffectType } from "@/lib/audio";
import { getEffectParamDefs } from "@/lib/audio/dsp/effects/param-traversal";
import type { EffectParamDef } from "@/lib/audio/dsp/effects/param-types";
import {
  getEffectDefaultConfig,
  UNIVERSAL_EFFECT_PARAM_DEFS,
} from "@/lib/audio/dsp/effects/schema";
import { nodeMidiTargetPrefix } from "@/lib/midi/node-midi-actions";
import { getNodeDefinition } from "@/lib/node-graph/catalogue";
import { setEffectParams } from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  nodeStore,
  snapshotNodeGraph,
} from "@/lib/node-graph/node-store";
import { resetEffect } from "@/lib/node-graph/palette";
import type { EffectNodeType } from "@/lib/node-graph/schema";
import { type BackendBadge, nodeBackendBadges } from "@/lib/node-playback";
import { BackendBadgeLabel } from "./backend-badge";
import type { FlowNode, FlowNodeProps } from "./flow-adapter";
import {
  controlName,
  MAX_CONTROL_COLUMNS,
  ModuleControls,
  ModuleFrame,
  ModuleHeader,
  ModuleKnob,
  ModulePorts,
  ModuleSelect,
  ModuleSwitch,
  moduleWidth,
} from "./module-frame";
import { useNodeActions } from "./node-actions";
import { nodeIcon } from "./node-icons";

type EffectNodeData = { effect: EffectConfig };
export type EffectFlowNode = FlowNode<EffectNodeData, EffectNodeType>;

/** The header needs room for the title, a badge, the switch and the menu. */
const MIN_EFFECT_COLUMNS = 3;

/** The universal mix row, short-labelled as in the effect rack. */
const UNIVERSAL_LABELS: Record<string, string> = {
  dryWet: "Mix",
  inputGain: "In",
  outputGain: "Out",
};

export type BodyControl = {
  param: EffectParamDef;
  label: string;
  bipolar: boolean;
};

/**
 * The controls a node body shows: the first EFFECT_LAYOUTS row, at most
 * four. An effect without a layout shows its first params, and a split
 * (which has none) its mix row.
 */
export function firstLayoutRow(type: EffectType): BodyControl[] {
  const layout = EFFECT_LAYOUTS[type];
  const defs = getEffectParamDefs(type).filter(
    (param) => param.type !== "text"
  );
  const byKey = new Map(defs.map((param) => [param.key, param]));
  const firstRow = layout?.rows[0]?.keys.flatMap((key) => {
    const param = byKey.get(key);
    return param ? [param] : [];
  });
  if (firstRow && firstRow.length > 0) {
    return firstRow.slice(0, MAX_CONTROL_COLUMNS).map((param) => ({
      // As the effect rack decides it: a layout's list, or a centred range.
      bipolar: Boolean(
        layout?.bipolar?.includes(param.key) ??
          (param.type === "slider" && param.min < 0 && param.max > 0)
      ),
      label: shortLabel(layout?.labels?.[param.key] ?? param.label),
      param,
    }));
  }
  const params: EffectParamDef[] =
    defs.length > 0 ? defs : [...UNIVERSAL_EFFECT_PARAM_DEFS];
  return params.slice(0, MAX_CONTROL_COLUMNS).map((param) => ({
    bipolar: param.type === "slider" && param.min < 0 && param.max > 0,
    label: UNIVERSAL_LABELS[param.key] ?? shortLabel(param.label),
    param,
  }));
}

/** How wide an effect's node body draws. */
export function effectNodeWidth(type: EffectType): number {
  return moduleWidth(firstLayoutRow(type).length, MIN_EFFECT_COLUMNS);
}

function readValue(effect: EffectConfig, key: string): unknown {
  return (effect as unknown as Record<string, unknown>)[key];
}

function readDefault(type: EffectType, key: string): number | undefined {
  const value = (
    getEffectDefaultConfig(type) as Record<string, unknown> | undefined
  )?.[key];
  return typeof value === "number" ? value : undefined;
}

function BodyControlView({
  control: { param, label, bipolar },
  effect,
  title,
  onChange,
  onStep,
}: {
  control: BodyControl;
  effect: EffectConfig;
  title: string;
  onChange: (patch: Partial<EffectConfig>) => void;
  onStep: (patch: Partial<EffectConfig>) => void;
}) {
  const value = readValue(effect, param.key);
  const name = controlName(title, label);
  if (param.type === "slider") {
    if (typeof value !== "number") {
      return null;
    }
    return (
      <ModuleKnob
        bipolar={bipolar}
        defaultValue={readDefault(effect.type, param.key)}
        description={param.description}
        format={(next) => formatParam(param.formatKey ?? "default", next)}
        label={label}
        max={param.max}
        midiTargetId={`${nodeMidiTargetPrefix(effect.id)}:${param.key}`}
        min={param.min}
        name={name}
        onChange={(next) =>
          onChange({ [param.key]: next } as Partial<EffectConfig>)
        }
        step={param.step}
        value={value}
      />
    );
  }
  if (param.type === "select") {
    return (
      <ModuleSelect
        label={label}
        name={name}
        onChange={(next) => {
          // As the effect rack does: a numeric select commits a number.
          onStep({
            [param.key]:
              param.valueType === "number" ? Number.parseInt(next, 10) : next,
          } as Partial<EffectConfig>);
        }}
        options={param.options.map((option) => ({
          label: option.label,
          value: String(option.value),
        }))}
        value={String(value)}
      />
    );
  }
  if (param.type === "checkbox") {
    return (
      <ModuleSwitch
        checked={value === true}
        description={param.description}
        label={label}
        name={name}
        onChange={(checked) =>
          onStep({ [param.key]: checked } as Partial<EffectConfig>)
        }
      />
    );
  }
  return null;
}

export type EffectNodeBodyProps = {
  effect: EffectConfig;
  selected?: boolean;
  badge?: BackendBadge | null;
  /** A knob turn: folds into the next undo step. */
  onChange: (patch: Partial<EffectConfig>) => void;
  /** A switch or a pick: an undo step of its own. */
  onStep: (patch: Partial<EffectConfig>) => void;
  /** A knob released: the turn becomes an undo step. */
  onRelease: () => void;
  onRemove: () => void;
  /** Opens every param in the inspector. */
  onInspect?: () => void;
  /** "Swap effect…": another effect in its place, cables kept. */
  onSwap?: () => void;
  /**
   * Replaces the first layout row, `columns` wide: a Band Split shows its
   * bands and crossovers instead.
   */
  controls?: { columns: number; node: ReactNode };
};

/**
 * An effect as a node: icon tile, title, backend badge, enable switch and
 * menu, over the first row of its layout. The rest of its params wait for
 * the inspector.
 */
export function EffectNodeBody({
  effect,
  selected = false,
  badge = null,
  onChange,
  onStep,
  onRelease,
  onRemove,
  onInspect,
  onSwap,
  controls: custom,
}: EffectNodeBodyProps) {
  const title = getNodeDefinition(effect.type).name;
  const controls = custom ? [] : firstLayoutRow(effect.type);
  return (
    <ModuleFrame
      on={effect.enabled}
      selected={selected}
      width={moduleWidth(
        custom?.columns ?? controls.length,
        MIN_EFFECT_COLUMNS
      )}
    >
      <ModuleHeader
        badge={badge ? <BackendBadgeLabel badge={badge} /> : null}
        enabled={effect.enabled}
        icon={nodeIcon(effect.type)}
        on={effect.enabled}
        onEnabledChange={(enabled) => onStep({ enabled })}
        onInspect={onInspect}
        onRemove={onRemove}
        // A reset keeps the effect on or off; only its params go back.
        onReset={() => onStep(resetEffect(effect))}
        onSwap={onSwap}
        title={title}
      />
      <ModuleControls onRelease={onRelease}>
        {custom?.node}
        {controls.map((control) => (
          <BodyControlView
            control={control}
            effect={effect}
            key={control.param.key}
            onChange={onChange}
            onStep={onStep}
            title={title}
          />
        ))}
      </ModuleControls>
    </ModuleFrame>
  );
}

/** An FX node on the canvas: its body plus its ports. */
export function EffectNode({
  id,
  data,
  selected,
}: FlowNodeProps<EffectFlowNode>) {
  const actions = useNodeActions();
  const badge = useStore(nodeBackendBadges, (state) => state[id] ?? null);
  const { effect } = data;
  const commit = (patch: Partial<EffectConfig>, step: boolean) => {
    commitNodeGraph(
      (graph) => setEffectParams(graph, id, patch),
      nodeStore,
      step ? "snapshot" : undefined
    );
  };
  return (
    <>
      <EffectNodeBody
        badge={badge}
        effect={effect}
        onChange={(patch) => commit(patch, false)}
        onInspect={() => actions.inspectNode(id)}
        onRelease={() => snapshotNodeGraph()}
        onRemove={() => actions.removeNode(id)}
        onStep={(patch) => commit(patch, true)}
        onSwap={() => actions.swapEffect(id)}
        selected={selected}
      />
      <ModulePorts
        title={getNodeDefinition(effect.type).name}
        type={effect.type}
      />
    </>
  );
}
