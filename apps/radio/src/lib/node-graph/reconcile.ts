/**
 * Node Graph Reconcile
 *
 * Diffs two compiled plans by key into the smallest set of engine ops, so an
 * edit, an undo or a template load never rebuilds what did not change. The
 * node engine applies the ops in order, in one batch per store commit:
 *
 * - param-only FX change (same layout signature): `setLaneEffects`, which the
 *   effects controller no-ops when identical and openDAW updates in place;
 * - FX added, removed or reordered: `duckLane` → `replaceLaneEffects` →
 *   `unduckLane`, a short dip instead of a click;
 * - native pan, filter and cable levels: `setParam`, ramped by the engine;
 * - cables: `addEdge` fades in, `removeEdge` fades out, and `rewireEdge`
 *   (same cable id, new ends) crossfades equal-power;
 * - lanes: `addLane` builds the sound paused, `removeLane` fades it out.
 */

import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import type {
  EdgePlan,
  EnginePlan,
  LanePlan,
  NativeFilterPlan,
} from "./compile";

export type Op =
  | { type: "addLane"; lane: LanePlan }
  | { type: "removeLane"; laneId: string; soundId: string }
  | { type: "setLaneEffects"; laneId: string; effects: EffectConfig[] }
  | { type: "duckLane"; laneId: string }
  | { type: "replaceLaneEffects"; laneId: string; effects: EffectConfig[] }
  | { type: "unduckLane"; laneId: string }
  | {
      type: "setParam";
      target: "lane";
      id: string;
      param: "pan";
      value: number;
    }
  | {
      type: "setParam";
      target: "lane";
      id: string;
      param: "filter";
      value: NativeFilterPlan | null;
    }
  | {
      type: "setParam";
      target: "edge";
      id: string;
      param: "gain";
      value: number;
    }
  | {
      type: "setParam";
      target: "edge";
      id: string;
      param: "muted";
      value: boolean;
    }
  | { type: "addEdge"; edge: EdgePlan }
  | { type: "removeEdge"; edgeId: string }
  | { type: "rewireEdge"; edge: EdgePlan; previous: EdgePlan };

export type ReconcilablePlan = Pick<EnginePlan, "lanes" | "edges">;

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The part of a lane that needs a new sound when it changes. Renaming a
 * saved station keeps playing; a new stream starts over.
 */
function sourceKey({ radio }: LanePlan): string {
  return JSON.stringify([radio.id ?? null, radio.streamUrl]);
}

function sameEnds(left: EdgePlan, right: EdgePlan): boolean {
  return same([left.from, left.to], [right.from, right.to]);
}

function laneOps(previous: LanePlan, next: LanePlan): Op[] {
  const ops: Op[] = [];
  const laneId = next.id;
  if (previous.layoutSignature !== next.layoutSignature) {
    ops.push(
      { laneId, type: "duckLane" },
      { effects: next.effects, laneId, type: "replaceLaneEffects" },
      { laneId, type: "unduckLane" }
    );
  } else if (!same(previous.effects, next.effects)) {
    ops.push({ effects: next.effects, laneId, type: "setLaneEffects" });
  }
  if (previous.pan !== next.pan) {
    ops.push({
      id: laneId,
      param: "pan",
      target: "lane",
      type: "setParam",
      value: next.pan,
    });
  }
  if (!same(previous.filter, next.filter)) {
    ops.push({
      id: laneId,
      param: "filter",
      target: "lane",
      type: "setParam",
      value: next.filter,
    });
  }
  return ops;
}

function edgeOps(previous: EdgePlan, next: EdgePlan): Op[] {
  if (!sameEnds(previous, next)) {
    return [{ edge: next, previous, type: "rewireEdge" }];
  }
  const ops: Op[] = [];
  if (previous.gain !== next.gain) {
    ops.push({
      id: next.id,
      param: "gain",
      target: "edge",
      type: "setParam",
      value: next.gain,
    });
  }
  if (previous.muted !== next.muted) {
    ops.push({
      id: next.id,
      param: "muted",
      target: "edge",
      type: "setParam",
      value: next.muted,
    });
  }
  return ops;
}

/**
 * Diffs two plans by lane and cable id. Ops come in apply order: cables out,
 * lanes out, lanes in, lane changes, then cables in and cable changes, so a
 * cable never points at a lane that is not there. A cable leaving a lane
 * that goes away, or starts a new stream, goes with it and is added again.
 */
export function diff(previous: ReconcilablePlan, next: ReconcilablePlan): Op[] {
  const removedEdges: Op[] = [];
  const removedLanes: Op[] = [];
  const addedLanes: Op[] = [];
  const changedLanes: Op[] = [];
  const edges: Op[] = [];
  const replaced = new Set<string>();

  for (const [id, lane] of previous.lanes) {
    const kept = next.lanes.get(id);
    if (!kept || sourceKey(kept) !== sourceKey(lane)) {
      replaced.add(id);
      removedLanes.push({
        laneId: id,
        soundId: lane.soundId,
        type: "removeLane",
      });
    }
  }
  for (const [id, lane] of next.lanes) {
    const before = previous.lanes.get(id);
    if (!before || sourceKey(before) !== sourceKey(lane)) {
      addedLanes.push({ lane, type: "addLane" });
    } else {
      changedLanes.push(...laneOps(before, lane));
    }
  }

  const leaving = (edge: EdgePlan) => replaced.has(edge.from.id);
  for (const [id, edge] of previous.edges) {
    if (!next.edges.has(id) || leaving(edge)) {
      removedEdges.push({ edgeId: id, type: "removeEdge" });
    }
  }
  for (const [id, edge] of next.edges) {
    const before = previous.edges.get(id);
    edges.push(
      ...(before && !leaving(before)
        ? edgeOps(before, edge)
        : [{ edge, type: "addEdge" as const }])
    );
  }

  return [
    ...removedEdges,
    ...removedLanes,
    ...addedLanes,
    ...changedLanes,
    ...edges,
  ];
}
