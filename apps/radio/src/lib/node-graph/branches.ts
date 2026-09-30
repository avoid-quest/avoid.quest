/**
 * Split Branches
 *
 * The edits and names behind Split, Stereo Split and Band Split on the
 * canvas. Each branch is a cable out of one of the split's ports, and that
 * cable carries the branch's gain, pan, mute and solo; the compiler turns
 * them into the container's chains. A Band Split's band count and
 * crossovers live on its effect, and dropping a band drops its cables.
 */

import type {
  EffectChainConfig,
  EffectConfig,
  FrequencySplitConfig,
} from "@/lib/audio/dsp/effects/types";
import {
  isEffectContainer,
  isEffectContainerType,
} from "@/lib/audio/dsp/routing/effect-tree";
import { defaultChainGain, MAX_SPLIT_BRANCHES } from "./compile";
import type { EffectNodeType, GraphEdge, GraphNode, NodeGraph } from "./schema";
import { parseHandleId } from "./validate";

export type SplitType = "fxComposite" | "stereoSplit" | "frequencySplit";
export type SplitNode = Extract<GraphNode, { type: EffectNodeType }> & {
  type: SplitType;
};
export type BandCount = 2 | 3 | 4;

export const BAND_COUNTS: readonly BandCount[] = [2, 3, 4];

/** Band names by count, low to high, as the effect rack names them. */
export const BAND_NAMES: Record<BandCount, readonly string[]> = {
  2: ["Low", "High"],
  3: ["Low", "Mid", "High"],
  4: ["Low", "Low mid", "High mid", "High"],
};

/** Crossovers stay this far apart, and inside the audible range. */
export const MIN_CROSSOVER_HZ = 20;
export const MAX_CROSSOVER_HZ = 20_000;
const CROSSOVER_SPACING_HZ = 20;
const DEFAULT_CROSSOVERS: Record<BandCount, readonly number[]> = {
  2: [800],
  3: [250, 2500],
  4: [200, 1000, 5000],
};

export type BranchParams = Partial<
  Pick<GraphEdge, "gain" | "muted" | "pan" | "solo">
>;

export function isSplitNode(node: GraphNode | undefined): node is SplitNode {
  return node !== undefined && isEffectContainerType(node.type as SplitType);
}

function effectOf(node: SplitNode): EffectConfig {
  return (node.data as { effect: EffectConfig }).effect;
}

export function bandCountOf(effect: FrequencySplitConfig): BandCount {
  const count = effect.crossoverFrequencies.length + 1;
  return Math.min(4, Math.max(2, count)) as BandCount;
}

/** The port index a split's out handle names: `branch-2` → 2, `right` → 2. */
export function branchIndex(handle: string): number {
  const name = parseHandleId(handle)?.name ?? "";
  if (name === "left") {
    return 1;
  }
  if (name === "right") {
    return 2;
  }
  const index = Number.parseInt(name.split("-").at(-1) ?? "", 10);
  return Number.isFinite(index) ? index : 0;
}

/** The out port ids a split shows: every band, both sides, or the branches in use plus one. */
export function splitPortIds(
  node: SplitNode,
  edges: readonly Pick<GraphEdge, "source" | "sourceHandle">[]
): string[] {
  const effect = effectOf(node);
  if (effect.type === "stereoSplit") {
    return ["left", "right"];
  }
  if (effect.type === "frequencySplit") {
    return Array.from(
      { length: bandCountOf(effect) },
      (_, index) => `band-${index + 1}`
    );
  }
  // A Split grows a port as each one is cabled, from two up to four.
  const used = edges
    .filter((edge) => edge.source === node.id)
    .map((edge) => branchIndex(edge.sourceHandle));
  const count = Math.min(
    MAX_SPLIT_BRANCHES,
    Math.max(2, Math.max(0, ...used) + 1)
  );
  return Array.from({ length: count }, (_, index) => `branch-${index + 1}`);
}

/** A branch as the canvas and inspector name it: "Branch 2", "Left", "Mid". */
export function branchName(node: SplitNode, handle: string): string {
  const effect = effectOf(node);
  const index = branchIndex(handle);
  if (effect.type === "stereoSplit") {
    return index === 1 ? "Left" : "Right";
  }
  if (effect.type === "frequencySplit") {
    return BAND_NAMES[bandCountOf(effect)][index - 1] ?? `Band ${index}`;
  }
  return `Branch ${index}`;
}

/** The short tag on a branch cable: "2", "L", "Mid". */
export function branchTag(node: SplitNode, handle: string): string {
  const name = branchName(node, handle);
  if (effectOf(node).type === "fxComposite") {
    return String(branchIndex(handle));
  }
  return effectOf(node).type === "stereoSplit" ? name.charAt(0) : name;
}

/** The configured chain gain underneath a branch cable's additional trim. */
export function branchBaseGain(node: SplitNode, handle: string): number {
  const effect = effectOf(node);
  if (!isEffectContainer(effect)) {
    return 1;
  }
  const chains = [...effect.chains].sort(
    (left, right) => left.order - right.order
  );
  return chains[branchIndex(handle) - 1]?.gain ?? defaultChainGain(node.type);
}

/** The audio cables leaving a split, in port order: its branches. */
export function branchCables(
  graph: Pick<NodeGraph, "edges">,
  nodeId: string
): GraphEdge[] {
  return graph.edges
    .filter(
      (edge) =>
        edge.source === nodeId &&
        parseHandleId(edge.sourceHandle)?.kind === "audio" &&
        parseHandleId(edge.targetHandle)?.kind === "audio"
    )
    .sort(
      (left, right) =>
        branchIndex(left.sourceHandle) - branchIndex(right.sourceHandle)
    );
}

/** Merges a branch cable's gain, pan, mute or solo. */
export function setBranchParams(
  graph: NodeGraph,
  edgeId: string,
  patch: BranchParams
): NodeGraph {
  let changed = false;
  const edges = graph.edges.map((edge) => {
    if (
      edge.id !== edgeId ||
      Object.entries(patch).every(
        ([key, value]) => edge[key as keyof BranchParams] === value
      )
    ) {
      return edge;
    }
    changed = true;
    return { ...edge, ...patch };
  });
  return changed ? { ...graph, edges } : graph;
}

/**
 * Crossovers for `count` bands: the lowest current ones kept, defaults
 * for new ones, each held above the last.
 */
export function resizeCrossovers(
  current: readonly number[],
  count: BandCount
): number[] {
  const crossovers: number[] = [];
  const total = count - 1;
  for (let index = 0; index < total; index += 1) {
    const floor =
      index === 0
        ? MIN_CROSSOVER_HZ
        : (crossovers[index - 1] ?? MIN_CROSSOVER_HZ) + CROSSOVER_SPACING_HZ;
    const ceiling =
      MAX_CROSSOVER_HZ - (total - index - 1) * CROSSOVER_SPACING_HZ;
    const preferred =
      current[index] ?? DEFAULT_CROSSOVERS[count][index] ?? floor;
    crossovers.push(Math.min(ceiling, Math.max(floor, preferred)));
  }
  return crossovers;
}

function withBandEffect(
  graph: NodeGraph,
  nodeId: string,
  update: (effect: FrequencySplitConfig) => FrequencySplitConfig | null
): NodeGraph {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.id !== nodeId || node.type !== "frequencySplit") {
      return node;
    }
    const effect = node.data.effect as FrequencySplitConfig;
    const next = update(effect);
    if (!next) {
      return node;
    }
    changed = true;
    return { ...node, data: { effect: next } } as GraphNode;
  });
  return changed ? { ...graph, nodes } : graph;
}

/**
 * A Band Split effect with `count` bands. Bands keep their ports low to
 * high, so growing adds a top band and shrinking drops the top one.
 */
export function withBandCount(
  effect: FrequencySplitConfig,
  count: BandCount
): FrequencySplitConfig {
  const chains = [...effect.chains].sort(
    (left, right) => left.order - right.order
  );
  return {
    ...effect,
    chains: BAND_NAMES[count].map(
      (name, order): EffectChainConfig => ({
        ...(chains[order] ?? {
          effects: [],
          gain: 1,
          id: `${effect.id}:band-${order + 1}`,
          muted: false,
          pan: 0,
          solo: false,
        }),
        name,
        order,
      })
    ),
    crossoverFrequencies: resizeCrossovers(effect.crossoverFrequencies, count),
    frequencyBandCount: count,
  };
}

/** Sets a Band Split's band count; a dropped band's cables go with it. */
export function setBandCount(
  graph: NodeGraph,
  nodeId: string,
  count: BandCount
): NodeGraph {
  const next = withBandEffect(graph, nodeId, (effect) =>
    bandCountOf(effect) === count &&
    effect.chains.length === count &&
    effect.frequencyBandCount === count
      ? null
      : withBandCount(effect, count)
  );
  if (next === graph) {
    return graph;
  }
  return {
    ...next,
    edges: next.edges.filter(
      (edge) =>
        !(
          edge.source === nodeId &&
          parseHandleId(edge.sourceHandle)?.name.startsWith("band-") &&
          branchIndex(edge.sourceHandle) > count
        )
    ),
  };
}

/** The range a crossover may take: above the one below, under the one above. */
export function crossoverRange(
  crossovers: readonly number[],
  index: number
): { min: number; max: number } {
  const below = crossovers[index - 1];
  const above = crossovers[index + 1];
  return {
    max: above === undefined ? MAX_CROSSOVER_HZ : above - CROSSOVER_SPACING_HZ,
    min: below === undefined ? MIN_CROSSOVER_HZ : below + CROSSOVER_SPACING_HZ,
  };
}

/** Moves one crossover, held between its neighbours so bands stay ordered. */
export function setCrossover(
  graph: NodeGraph,
  nodeId: string,
  index: number,
  frequency: number
): NodeGraph {
  return withBandEffect(graph, nodeId, (effect) => {
    const current = effect.crossoverFrequencies;
    if (index < 0 || index >= current.length) {
      return null;
    }
    const { max, min } = crossoverRange(current, index);
    const value = Math.min(max, Math.max(min, frequency));
    if (current[index] === value) {
      return null;
    }
    const crossoverFrequencies = [...current];
    crossoverFrequencies[index] = value;
    return { ...effect, crossoverFrequencies };
  });
}
