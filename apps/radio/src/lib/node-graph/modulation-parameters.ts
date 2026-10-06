import { ValueMapping } from "@opendaw/lib-std";
import { getEffectMidiParamDefs } from "@/lib/audio/dsp/effects/schema";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import { isEffectNodeType } from "./catalogue";
import {
  type GraphEdge,
  type GraphNode,
  graphNodeSchema,
  isModulationNode,
  isStripSource,
  type NodeGraph,
} from "./schema";
import { analyseGraph } from "./validate";

export type ModulationParameter = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  scale?: "log";
};

export type NativeParamRange = ModulationParameter & {
  key: "frequency" | "Q" | "pan" | "gainDb";
};

/** Native knobs, MIDI and modulation use the same control mapping. */
export const NATIVE_PARAM_RANGES: Record<
  "filter" | "pan" | "gain",
  readonly NativeParamRange[]
> = {
  filter: [
    {
      key: "frequency",
      label: "Cutoff",
      max: 20_000,
      min: 20,
      scale: "log",
      step: 1,
    },
    { key: "Q", label: "Q", max: 30, min: 0.1, scale: "log", step: 0.01 },
  ],
  gain: [{ key: "gainDb", label: "Gain", max: 24, min: -40, step: 0.1 }],
  pan: [{ key: "pan", label: "Pan", max: 1, min: -1, step: 0.01 }],
};

/** Only numeric, in-place controls: structural switches cannot be modulated. */
export function modulationParameters(node: GraphNode): ModulationParameter[] {
  switch (node.type) {
    case "filter":
      return NATIVE_PARAM_RANGES.filter.map((range) => ({
        ...range,
        label: range.key === "Q" ? "Resonance" : range.label,
      }));
    case "pan":
      return [...NATIVE_PARAM_RANGES.pan];
    case "gain":
      // Gain has no schema floor: include a quieter authored value in its travel.
      return NATIVE_PARAM_RANGES.gain.map((range) => ({
        ...range,
        min: Math.min(range.min, node.data.gainDb),
      }));
    default:
      break;
  }
  if (isStripSource(node)) {
    return [
      { key: "pan", label: "Pan", max: 1, min: -1, step: 0.01 },
      { key: "trimDb", label: "Trim", max: 12, min: -24, step: 0.1 },
    ];
  }
  if (!isEffectNodeType(node.type)) {
    return [];
  }
  const { effect } = node.data as { effect: EffectConfig };
  const values = effect as unknown as Record<string, unknown>;
  return getEffectMidiParamDefs(effect.type).filter(
    (parameter) =>
      typeof values[parameter.key] === "number" &&
      // Autotune uses a direct device layout, without the universal gain wrapper.
      !(
        effect.type === "autotune" &&
        ["dryWet", "inputGain", "outputGain"].includes(parameter.key)
      )
  );
}

export function modulatedValue(
  base: number,
  offset: number,
  range: ModulationParameter
): number {
  if (offset === 0) {
    return base;
  }
  const mapping =
    range.scale === "log"
      ? ValueMapping.exponential(range.min, range.max)
      : ValueMapping.linear(range.min, range.max);
  const value = Math.max(
    0,
    Math.min(1, mapping.x(mapping.clamp(base)) + offset)
  );
  const scaled = mapping.y(value);
  return Math.max(
    range.min,
    Math.min(range.max, Math.round(scaled / range.step) * range.step)
  );
}

/** Resolve once per authored graph; rejected cables and nodes remain inert. */
export function parameterCables(graph: NodeGraph): GraphEdge[] {
  const { wired, issues } = analyseGraph(graph);
  const refusedEdges = new Set(
    issues.filter((issue) => issue.target === "edge").map((issue) => issue.id)
  );
  const refusedNodes = new Set(
    issues.filter((issue) => issue.target === "node").map((issue) => issue.id)
  );
  return wired
    .filter(
      ({ edge }) =>
        edge.targetHandle === "in:control:parameter" &&
        !refusedEdges.has(edge.id) &&
        !refusedNodes.has(edge.source) &&
        !refusedNodes.has(edge.target)
    )
    .map(({ edge }) => edge);
}

function changedParameters(
  values: Record<string, unknown>,
  ranges: readonly ModulationParameter[],
  entries: ReadonlyMap<string, number>
): Record<string, unknown> | null {
  let next: Record<string, unknown> | null = null;
  for (const range of ranges) {
    const offset = entries.get(range.key);
    const base = values[range.key];
    if (offset === undefined || typeof base !== "number") {
      continue;
    }
    const value = modulatedValue(base, offset, range);
    if (value !== base) {
      next ??= { ...values };
      next[range.key] = value;
    }
  }
  return next;
}

/** An ephemeral graph for the compiler; the editor and undo retain authored values. */
export function applyModulation(
  graph: NodeGraph,
  outputs: Readonly<Record<string, number>>,
  cables: readonly GraphEdge[] = parameterCables(graph)
): NodeGraph {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const offsets = new Map<string, Map<string, number>>();
  for (const edge of cables) {
    if (edge.muted || edge.targetHandle !== "in:control:parameter") {
      continue;
    }
    const value = outputs[edge.source];
    const source = nodes.get(edge.source);
    if (
      !(
        source &&
        ((isModulationNode(source) && source.data.enabled) ||
          source.type === "merge" ||
          source.type === "fxComposite")
      )
    ) {
      continue;
    }
    const target = nodes.get(edge.target);
    if (!target || value === undefined || !Number.isFinite(value)) {
      continue;
    }
    const ranges = modulationParameters(target);
    const parameter = ranges.find(
      (range) => range.key === (edge.parameter ?? ranges[0]?.key)
    );
    if (!parameter) {
      continue;
    }
    const entries = offsets.get(target.id) ?? new Map<string, number>();
    entries.set(
      parameter.key,
      (entries.get(parameter.key) ?? 0) + value * (edge.depth ?? 0.25)
    );
    offsets.set(target.id, entries);
  }
  if (offsets.size === 0) {
    return graph;
  }
  let changed = false;
  const nextNodes = graph.nodes.map((node) => {
    const entries = offsets.get(node.id);
    if (!entries) {
      return node;
    }
    const source = isStripSource(node);
    const effect = isEffectNodeType(node.type);
    const data = node.data as Record<string, unknown>;
    let values = data;
    if (source) {
      values = data.strip as Record<string, unknown>;
    } else if (effect) {
      values = data.effect as Record<string, unknown>;
    }
    const next = changedParameters(values, modulationParameters(node), entries);
    if (!next) {
      return node;
    }
    changed = true;
    if (source) {
      return { ...node, data: { ...data, strip: next } } as GraphNode;
    }
    if (effect) {
      return { ...node, data: { effect: next } } as GraphNode;
    }
    return { ...node, data: next } as GraphNode;
  });
  return changed ? { ...graph, nodes: nextNodes } : graph;
}

/** Validate edits at the same boundary used by imports and palette defaults. */
export function setModulatorParams(
  graph: NodeGraph,
  id: string,
  patch: Record<string, unknown>
): NodeGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.id !== id || !isModulationNode(node)) {
        return node;
      }
      const parsed = graphNodeSchema.safeParse({
        ...node,
        data: { ...node.data, ...patch },
      });
      return parsed.success ? parsed.data : node;
    }),
  };
}
