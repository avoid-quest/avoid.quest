/**
 * Node Graph Reconcile
 *
 * Diffs two compiled plans by key into the smallest set of engine ops, so an
 * edit, an undo or a template load never rebuilds what did not change. The
 * node engine applies the ops in order, in one batch per store commit:
 *
 * - param-only FX change (same layout signature): `setEffectFields`, a direct
 *   field write; structural device edits keep `setLaneEffects`;
 * - FX added, removed or reordered: `replaceLaneEffects`, which the engine
 *   swaps under a short duck instead of a click;
 * - native pan and filter, a source's volume and mute, a Track's or
 *   File's transport and cue listen, and an Audio input's channels:
 *   `setParam`, ramped by the engine;
 * - lanes: `addLane` builds the sound paused, `removeLane` fades it out.
 *
 * Cables, units and modules follow the plan level-triggered in the engine's
 * routing graph, so they need no ops; a unit sorts its effects' changes
 * with the same `effectsChange` a lane does.
 */

import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  audibleSidechainIds,
  effectFieldsAreStructural,
  localEffectConfig,
  visitEffectTree,
} from "@/lib/audio/dsp/routing/effect-tree";
import { toPlaybackInput } from "@/lib/audio/playback/playback-input";
import type { Radio } from "@/lib/audio/playback/types";
import type {
  ChannelSelectionPlan,
  EnginePlan,
  LanePlan,
  LaneTransport,
  NativeFilterPlan,
} from "./compile";

export type Op =
  | { type: "addLane"; lane: LanePlan }
  | { type: "removeLane"; laneId: string; soundId: string }
  | {
      type: "setEffectFields";
      laneId: string;
      effectId: string;
    }
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
    };

export type ReconcilablePlan = Pick<EnginePlan, "lanes">;

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

/** What an insert's effects are reconciled from: a lane's or a unit's. */
type EffectsOwnerPlan = Pick<
  LanePlan,
  "layoutSignature" | "backend" | "effects"
>;

/**
 * How an insert's effects changed, by what applying it takes: `layout`
 * swaps the FX layout under a duck, `structural` reconciles in place, and
 * `fields` writes just those effects' fields. Null when nothing changed.
 */
export type EffectsChange =
  | { kind: "layout" | "structural" }
  | { kind: "fields"; effectIds: string[] };

export function effectsChange(
  previous: EffectsOwnerPlan,
  next: EffectsOwnerPlan
): EffectsChange | null {
  if (previous.layoutSignature !== next.layoutSignature) {
    return { kind: "layout" };
  }
  // Every key an effect starts or stops listening to registers or releases
  // its channels, which only a reconcile does.
  if (
    previous.backend !== next.backend ||
    !same(
      audibleSidechainIds(previous.effects),
      audibleSidechainIds(next.effects)
    )
  ) {
    return { kind: "structural" };
  }
  if (same(previous.effects, next.effects)) {
    return null;
  }
  const before = new Map<string, EffectConfig>();
  visitEffectTree(previous.effects, (effect) => before.set(effect.id, effect));
  const effectIds: string[] = [];
  let structural = false;
  visitEffectTree(next.effects, (config) => {
    const existing = before.get(config.id);
    if (!existing || effectFieldsAreStructural(existing, config)) {
      structural = true;
    } else if (!same(localEffectConfig(existing), localEffectConfig(config))) {
      effectIds.push(config.id);
    }
  });
  return structural ? { kind: "structural" } : { effectIds, kind: "fields" };
}

function laneOps(previous: LanePlan, next: LanePlan): Op[] {
  const ops: Op[] = [];
  const laneId = next.id;
  const change = effectsChange(previous, next);
  if (change?.kind === "fields") {
    ops.push(
      ...change.effectIds.map((effectId) => ({
        effectId,
        laneId,
        type: "setEffectFields" as const,
      }))
    );
  } else if (change) {
    ops.push({
      effects: next.effects,
      laneId,
      type: change.kind === "layout" ? "replaceLaneEffects" : "setLaneEffects",
    });
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

/**
 * Diffs two plans by lane id. Ops come in apply order: lanes out, lanes in,
 * then lane changes. A lane that starts a new stream goes and comes back.
 */
export function diff(previous: ReconcilablePlan, next: ReconcilablePlan): Op[] {
  const removedLanes: Op[] = [];
  const addedLanes: Op[] = [];
  const changedLanes: Op[] = [];

  for (const [id, lane] of previous.lanes) {
    const kept = next.lanes.get(id);
    if (!kept || sourceKey(kept) !== sourceKey(lane)) {
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

  return [...removedLanes, ...addedLanes, ...changedLanes];
}
