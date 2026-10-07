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
import { analyseGraph, type Connection } from "./validate";

export const controlDepth = (edge: GraphEdge): number =>
  edge.depth ?? (edge.targetHandle === "in:control:parameter" ? 0.25 : 1);

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
  return getEffectMidiParamDefs(effect.type)
    .filter((parameter) => typeof values[parameter.key] === "number")
    .map((parameter) => ({
      ...parameter,
      ...(parameter.formatKey === "frequency" && parameter.min > 0
        ? { scale: "log" as const }
        : {}),
    }));
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

/** Parameter cables are resolved only on authored commits. */
export function parameterCables(
  graph: Pick<NodeGraph, "nodes" | "edges">,
  analysis = analyseGraph(graph)
): GraphEdge[] {
  const { wired, issues } = analysis;
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

/** Cable identity includes the effective parameter, even when omitted. */
export function connectionKey(
  graph: Pick<NodeGraph, "nodes" | "edges">,
  connection: Connection
): string {
  const parts = [
    connection.source,
    connection.sourceHandle,
    connection.target,
    connection.targetHandle,
  ];
  if (connection.targetHandle === "in:control:parameter") {
    const target = graph.nodes.find((node) => node.id === connection.target);
    parts.push(
      connection.parameter ??
        (target ? modulationParameters(target)[0]?.key : "") ??
        ""
    );
  }
  return parts.join("\u0000");
}

export function connectionParameter(
  graph: Pick<NodeGraph, "nodes" | "edges">,
  connection: Connection
) {
  if (
    connection.parameter !== undefined ||
    connection.targetHandle !== "in:control:parameter"
  ) {
    return connection.parameter;
  }
  const target = graph.nodes.find((node) => node.id === connection.target);
  const ranges = target ? modulationParameters(target) : [];
  const used = new Set(graph.edges.map((edge) => connectionKey(graph, edge)));
  return (
    ranges.find(
      (range) =>
        !used.has(connectionKey(graph, { ...connection, parameter: range.key }))
    )?.key ?? ranges[0]?.key
  );
}
