/**
 * Node Graph Reconcile
 *
 * Diffs two compiled plans by key into the smallest set of engine ops, so an
 * edit, an undo or a template load never rebuilds what did not change. The
 * node engine applies the ops in order, in one batch per store commit:
 *
 * - param-only FX change (same layout signature): `setLaneEffects`, which the
 *   effects controller no-ops when identical and openDAW updates in place;
 * - FX added, removed or reordered: `replaceLaneEffects`, which the engine
 *   swaps under a short duck instead of a click;
 * - native pan, filter and cable levels, a source's volume and mute, a
 *   Track's or File's transport and cue listen, and an Audio input's
 *   channels: `setParam`, ramped by the engine;
 * - cables: `addEdge` fades in, `removeEdge` fades out, and `rewireEdge`
 *   (same cable id, new ends) crossfades equal-power;
 * - lanes: `addLane` builds the sound paused, `removeLane` fades it out.
 */

import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import { toPlaybackInput } from "@/lib/audio/playback/playback-input";
import type { Radio } from "@/lib/audio/playback/types";
import type {
  ChannelSelectionPlan,
  EdgePlan,
  EnginePlan,
  LanePlan,
  LaneTransport,
  NativeFilterPlan,
} from "./compile";

export type Op =
  | { type: "addLane"; lane: LanePlan }
  | { type: "removeLane"; laneId: string; soundId: string }
  | { type: "setLaneEffects"; laneId: string; effects: EffectConfig[] }
  | { type: "replaceLaneEffects"; laneId: string; effects: EffectConfig[] }
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
      target: "lane";
      id: string;
      param: "volume";
      value: number;
    }
  | {
      type: "setParam";
      target: "lane";
      id: string;
      param: "muted";
      value: boolean;
    }
  | {
      type: "setParam";
      target: "lane";
      id: string;
      param: "channelSelection";
      value: ChannelSelectionPlan;
    }
  | {
      type: "setParam";
      target: "lane";
      id: string;
      param: "transport";
      value: LaneTransport;
    }
  | {
      type: "setParam";
      target: "lane";
      id: string;
      param: "cueListen";
      value: boolean;
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
 * saved station keeps playing; a new stream, or a new stream format or
 * platform that changes how it loads, starts over. An Audio input starts
 * over on a new device or echo cancellation, which are capture
 * constraints; its channels switch live.
 */
function sourceKey({ radio, source }: LanePlan): string {
  if (source.kind === "device") {
    return JSON.stringify(["device", source.deviceId, source.echoCancellation]);
  }
  return JSON.stringify([
    radio.id ?? null,
    radio.streamUrl,
    toPlaybackInput(radio as Radio),
  ]);
}

function channelsOf({ source }: LanePlan): ChannelSelectionPlan | null {
  return source.kind === "device" ? source.channelSelection : null;
}

function sameEnds(left: EdgePlan, right: EdgePlan): boolean {
  return same([left.from, left.to], [right.from, right.to]);
}

function laneOps(previous: LanePlan, next: LanePlan): Op[] {
  const ops: Op[] = [];
  const laneId = next.id;
  if (previous.layoutSignature !== next.layoutSignature) {
    ops.push({ effects: next.effects, laneId, type: "replaceLaneEffects" });
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
  // Volume before mute: unmuting re-applies the volume that is current.
  if (previous.volume !== next.volume) {
    ops.push({
      id: laneId,
      param: "volume",
      target: "lane",
      type: "setParam",
      value: next.volume,
    });
  }
  if (previous.muted !== next.muted) {
    ops.push({
      id: laneId,
      param: "muted",
      target: "lane",
      type: "setParam",
      value: next.muted,
    });
  }
  if (next.transport && !same(previous.transport, next.transport)) {
    ops.push({
      id: laneId,
      param: "transport",
      target: "lane",
      type: "setParam",
      value: next.transport,
    });
  }
  if (previous.cueListen !== next.cueListen) {
    ops.push({
      id: laneId,
      param: "cueListen",
      target: "lane",
      type: "setParam",
      value: next.cueListen,
    });
  }
  const channels = channelsOf(next);
  if (channels && !same(channelsOf(previous), channels)) {
    ops.push({
      id: laneId,
      param: "channelSelection",
      target: "lane",
      type: "setParam",
      value: channels,
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
