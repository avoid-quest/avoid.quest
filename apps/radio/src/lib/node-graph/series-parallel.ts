/**
 * Series ⇄ Parallel
 *
 * The two keyboard edits behind `P` and `S`. `P` takes two selected FX in
 * series (A → B) and puts them side by side: Split → A, B → Merge, with the
 * cable into A now feeding the Split and B's cables now leaving the Merge.
 * `S` undoes that shape: a Split whose two branches are one FX each, meeting
 * in one Merge, goes back to A → B. Cables keep their ids, gains and mutes
 * where they survive (the A → B cable rides B's branch and comes back).
 * `S` puts A where the Split is and B where the Merge is, so `P` then `S`
 * puts them back where `P` found them unless `P` had to move the Merge right
 * to make room for the branches; undo restores the exact layout. Both are
 * pure; the canvas commits each as one undo step.
 */

import { isEffectContainerType } from "@/lib/audio/dsp/routing/effect-tree";
import { branchIndex } from "./branches";
import { isEffectNodeType } from "./catalogue";
import { freshNodeId, newIssue, uniqueId } from "./graph-edits";
import type { NodeSelection } from "./node-store";
import { createPaletteNode } from "./palette";
import type { GraphEdge, GraphNode, NodeGraph } from "./schema";
import { AUDIO_IN_HANDLE, AUDIO_OUT_HANDLE } from "./templates";
import { parseHandleId, type ValidateOptions } from "./validate";

export type SeriesParallelEdit =
  | { ok: true; graph: NodeGraph; selection: NodeSelection }
  | { ok: false; message: string };

/** Where the branches go right of the Split, and the Merge right of them. */
const COLUMN_PX = 320;
/** How far each branch sits above or below the old series line. */
const BRANCH_OFFSET_PX = 90;

const SPLIT_TYPE = "fxComposite";

const NEEDS_SERIES = "Select two FX cabled one after the other";
const NEEDS_PARALLEL =
  "Select a Split whose two branches are one FX each, joined by a Merge";

function branchHandle(index: number): string {
  return `out:audio:branch-${index}`;
}

/**
 * An FX that can sit in a branch: any effect but a split, or a Gain trim.
 * Filter and Pan belong right after the station, so they stay in series.
 */
function isSeriesFx(node: GraphNode | undefined): node is GraphNode {
  return Boolean(
    node &&
      (node.type === "gain" ||
        (isEffectNodeType(node.type) && !isEffectContainerType(node.type)))
  );
}

function isAudio(edge: GraphEdge): boolean {
  return (
    parseHandleId(edge.sourceHandle)?.kind === "audio" &&
    parseHandleId(edge.targetHandle)?.kind === "audio"
  );
}

/** Audio cables into a node's audio input; keys stay where they are. */
function audioIns(graph: NodeGraph, id: string): GraphEdge[] {
  return graph.edges.filter((edge) => edge.target === id && isAudio(edge));
}

/** Audio cables out of a node into another's audio input. */
function audioOuts(graph: NodeGraph, id: string): GraphEdge[] {
  return graph.edges.filter((edge) => edge.source === id && isAudio(edge));
}

function nodeById(graph: NodeGraph, id: string): GraphNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

function cable(
  taken: Set<string>,
  source: string,
  sourceHandle: string,
  target: string
): GraphEdge {
  const id = uniqueId(`${source}->${target}`, taken);
  taken.add(id);
  return {
    gain: 1,
    id,
    muted: false,
    source,
    sourceHandle,
    target,
    targetHandle: AUDIO_IN_HANDLE,
  };
}

/** The two selected FX as [first, second] when one feeds the other directly. */
function seriesPair(
  graph: NodeGraph,
  selection: NodeSelection
): [GraphNode, GraphNode, GraphEdge] | null {
  const [left, right, ...rest] = selection.nodes.map((id) =>
    nodeById(graph, id)
  );
  if (rest.length > 0 || !(isSeriesFx(left) && isSeriesFx(right))) {
    return null;
  }
  for (const [first, second] of [
    [left, right],
    [right, left],
  ] as const) {
    const outs = audioOuts(graph, first.id);
    const ins = audioIns(graph, second.id);
    const [link] = outs;
    if (
      outs.length === 1 &&
      ins.length === 1 &&
      link &&
      link.target === second.id &&
      ins[0] === link
    ) {
      return [first, second, link];
    }
  }
  return null;
}

/**
 * P: two FX in series become Split → both → Merge. Refused when the result
 * would not compile.
 */
export function seriesToParallel(
  graph: NodeGraph,
  selection: NodeSelection,
  options?: ValidateOptions
): SeriesParallelEdit {
  const pair = seriesPair(graph, selection);
  if (!pair) {
    return { message: NEEDS_SERIES, ok: false };
  }
  const [first, second, link] = pair;
  // A deleted Split keeps its MIDI mappings for Undo, so a new one never
  // takes its id; a Merge has no MIDI targets.
  const splitId = freshNodeId(SPLIT_TYPE);
  const mergeId = uniqueId(
    "merge",
    new Set(graph.nodes.map((node) => node.id))
  );
  const { x, y } = first.position;
  const branchX = x + COLUMN_PX;
  const split = createPaletteNode(SPLIT_TYPE, splitId, { x, y });
  // The Merge takes B's place unless the branches need the room.
  const merge = createPaletteNode("merge", mergeId, {
    x: Math.max(second.position.x, branchX + COLUMN_PX),
    y: second.position.y,
  });
  if (!(split && merge)) {
    return { message: NEEDS_SERIES, ok: false };
  }

  const [into] = audioIns(graph, first.id);
  const outOf = new Set(audioOuts(graph, second.id).map((edge) => edge.id));
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));
  const edges = graph.edges.flatMap((edge): GraphEdge[] => {
    if (edge === link) {
      return [];
    }
    if (edge === into) {
      return [{ ...edge, target: splitId, targetHandle: AUDIO_IN_HANDLE }];
    }
    if (outOf.has(edge.id)) {
      return [{ ...edge, source: mergeId, sourceHandle: AUDIO_OUT_HANDLE }];
    }
    return [edge];
  });
  // The A → B cable fed B, so B's branch takes its id, level and mute, and
  // S hands them back.
  const { pan: _pan, solo: _solo, ...linkKept } = link;
  edges.push(
    cable(edgeIds, splitId, branchHandle(1), first.id),
    {
      ...linkKept,
      source: splitId,
      sourceHandle: branchHandle(2),
      target: second.id,
      targetHandle: AUDIO_IN_HANDLE,
    },
    cable(edgeIds, first.id, AUDIO_OUT_HANDLE, mergeId),
    cable(edgeIds, second.id, AUDIO_OUT_HANDLE, mergeId)
  );

  const nodes = graph.nodes.map((node) => {
    if (node.id === first.id) {
      return { ...node, position: { x: branchX, y: y - BRANCH_OFFSET_PX } };
    }
    if (node.id === second.id) {
      return { ...node, position: { x: branchX, y: y + BRANCH_OFFSET_PX } };
    }
    return node;
  });
  const next = { ...graph, edges, nodes: [...nodes, split, merge] };
  const issue = newIssue(graph, next, options);
  if (issue) {
    return { message: issue.message, ok: false };
  }
  return {
    graph: next,
    ok: true,
    selection: { edges: [], nodes: [first.id, second.id] },
  };
}

type ParallelRegion = {
  split: GraphNode;
  merge: GraphNode;
  /** The branch FX in port order: the first runs first in series. */
  first: GraphNode;
  second: GraphNode;
  /** The Split → B cable: it becomes the A → B cable again. */
  secondBranch: GraphEdge;
  /** Every cable inside the region: two out of the Split, two into the Merge. */
  inner: Set<GraphEdge>;
};

/** The region `split` opens, when it is two single-FX branches into one Merge. */
function regionOf(
  graph: NodeGraph,
  split: GraphNode | undefined
): ParallelRegion | null {
  if (split?.type !== SPLIT_TYPE) {
    return null;
  }
  const branches = audioOuts(graph, split.id).sort(
    (left, right) =>
      branchIndex(left.sourceHandle) - branchIndex(right.sourceHandle)
  );
  const [one, two, ...extra] = branches;
  // Two cables off one port are a fan-out inside that branch, not two branches.
  if (
    !(one && two) ||
    extra.length > 0 ||
    one.sourceHandle === two.sourceHandle ||
    one.target === two.target
  ) {
    return null;
  }
  const first = nodeById(graph, one.target);
  const second = nodeById(graph, two.target);
  if (!(isSeriesFx(first) && isSeriesFx(second))) {
    return null;
  }
  const exits = [first, second].map((node) => audioOuts(graph, node.id));
  const [firstExit] = exits[0] ?? [];
  const [secondExit] = exits[1] ?? [];
  if (
    !(firstExit && secondExit) ||
    exits.some((outs) => outs.length !== 1) ||
    firstExit.target !== secondExit.target ||
    [first, second].some((node) => audioIns(graph, node.id).length !== 1)
  ) {
    return null;
  }
  const merge = nodeById(graph, firstExit.target);
  if (merge?.type !== "merge" || audioIns(graph, merge.id).length !== 2) {
    return null;
  }
  return {
    first,
    inner: new Set([one, two, firstExit, secondExit]),
    merge,
    second,
    secondBranch: two,
    split,
  };
}

/** The region the selection points at: its Split, its Merge or a branch FX. */
function selectedRegion(
  graph: NodeGraph,
  selection: NodeSelection
): ParallelRegion | null {
  const splits = new Set<string>();
  for (const id of selection.nodes) {
    const node = nodeById(graph, id);
    if (node?.type === SPLIT_TYPE) {
      splits.add(id);
    } else if (node?.type === "merge") {
      for (const edge of audioIns(graph, id)) {
        for (const upstream of audioIns(graph, edge.source)) {
          splits.add(upstream.source);
        }
      }
    } else {
      for (const edge of audioIns(graph, id)) {
        splits.add(edge.source);
      }
    }
  }
  const regions = [...splits]
    .map((id) => regionOf(graph, nodeById(graph, id)))
    .filter((region): region is ParallelRegion => region !== null);
  return regions.length === 1 ? (regions[0] ?? null) : null;
}

/** S: a Split → A, B → Merge region goes back to A → B. */
export function parallelToSeries(
  graph: NodeGraph,
  selection: NodeSelection
): SeriesParallelEdit {
  const region = selectedRegion(graph, selection);
  if (!region) {
    return { message: NEEDS_PARALLEL, ok: false };
  }
  const { first, inner, merge, second, secondBranch, split } = region;
  const edges = graph.edges.flatMap((edge): GraphEdge[] => {
    if (inner.has(edge)) {
      return [];
    }
    if (edge.target === split.id && isAudio(edge)) {
      return [{ ...edge, target: first.id, targetHandle: AUDIO_IN_HANDLE }];
    }
    if (edge.source === merge.id && isAudio(edge)) {
      return [{ ...edge, source: second.id, sourceHandle: AUDIO_OUT_HANDLE }];
    }
    // Anything else on the Split or Merge (none today) goes with them.
    if (
      edge.source === split.id ||
      edge.target === split.id ||
      edge.source === merge.id ||
      edge.target === merge.id
    ) {
      return [];
    }
    return [edge];
  });
  // B's branch cable becomes A → B again, with its id, level and mute.
  const { pan: _pan, solo: _solo, ...kept } = secondBranch;
  edges.push({
    ...kept,
    source: first.id,
    sourceHandle: AUDIO_OUT_HANDLE,
    target: second.id,
    targetHandle: AUDIO_IN_HANDLE,
  });

  const nodes = graph.nodes.flatMap((node): GraphNode[] => {
    if (node.id === split.id || node.id === merge.id) {
      return [];
    }
    if (node.id === first.id) {
      return [{ ...node, position: split.position }];
    }
    if (node.id === second.id) {
      return [{ ...node, position: merge.position }];
    }
    return [node];
  });
  return {
    graph: { ...graph, edges, nodes },
    ok: true,
    selection: { edges: [], nodes: [first.id, second.id] },
  };
}
