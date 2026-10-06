import { ValueMapping } from "@opendaw/lib-std";
import { getEffectMidiParamDefs } from "@/lib/audio/dsp/effects/schema";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import { isEffectNodeType } from "./catalogue";
import {
  type GraphNode,
  graphNodeSchema,
  isModulationNode,
  isStripSource,
  type NodeGraph,
} from "./schema";

export type ModulationParameter = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  scale?: "log";
};

/** Only numeric, in-place controls: structural switches cannot be modulated. */
export function modulationParameters(node: GraphNode): ModulationParameter[] {
  switch (node.type) {
    case "filter":
      return [
        {
          key: "frequency",
          label: "Cutoff",
          max: 20_000,
          min: 20,
          scale: "log",
          step: 1,
        },
        { key: "Q", label: "Resonance", max: 30, min: 0.1, step: 0.01 },
      ];
    case "pan":
      return [{ key: "pan", label: "Pan", max: 1, min: -1, step: 0.01 }];
    case "gain":
      return [{ key: "gainDb", label: "Gain", max: 24, min: -40, step: 0.1 }];
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

/** An ephemeral graph for the compiler; the editor and undo retain authored values. */
export function applyModulation(
  graph: NodeGraph,
  outputs: Readonly<Record<string, number>>
): NodeGraph {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const offsets = new Map<string, Map<string, number>>();
  for (const edge of graph.edges) {
    if (edge.muted || edge.targetHandle !== "in:control:parameter") {
      continue;
    }
    const value = outputs[edge.source];
    const source = nodes.get(edge.source);
    if (!(isModulationNode(source) && source.data.enabled)) {
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
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
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
      const next = { ...values };
      for (const range of modulationParameters(node)) {
        const offset = entries.get(range.key);
        const base = values[range.key];
        if (offset !== undefined && typeof base === "number") {
          next[range.key] = modulatedValue(base, offset, range);
        }
      }
      if (source) {
        return { ...node, data: { ...data, strip: next } } as GraphNode;
      }
      if (effect) {
        return { ...node, data: { effect: next } } as GraphNode;
      }
      return { ...node, data: next } as GraphNode;
    }),
  };
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
