/**
 * Node Effects Slot
 *
 * Drives one insert's effects toward its plan, for a lane's sound and for
 * a graph unit alike. Changed effects are reconciled with the latest plan;
 * a new FX layout swaps under a duck that lifts once the latest layout is
 * in, unless nothing plays to duck. The layout stays unknown until a
 * reconcile succeeds, since a failed, superseded or rejected one may have
 * half-switched the graph: the next change swaps, ducked. A knob edit that
 * keeps the layout writes just that effect's fields, and reconciles if the
 * write could not land. A unit's attach is its first reconcile, kept the
 * same way. Its owner runs each step it gets and asks again until there is
 * none.
 */

import type { EffectsFallbackCause } from "@/lib/audio/dsp/effects/official-opendaw-mapping";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import { findEffectInTree } from "@/lib/audio/dsp/routing/effect-tree";
import type { EffectWriteResult } from "@/lib/audio/manager/effects-graph-runtime";
import type { EffectsRuntimeOutcome } from "@/lib/channel-effects";
import type { LanePlan } from "@/lib/node-graph/compile";

export type EffectsBackend = EffectsRuntimeOutcome["backend"];

/**
 * What an FX node's badge says. None while its lane runs as planned or has
 * no effects runtime; `compat` on the compatibility worklet, with why when
 * known; `bypassed` when the controller fell back dry.
 */
export type BackendBadge =
  | { kind: "compat"; cause?: EffectsFallbackCause }
  | { kind: "bypassed" };

/**
 * A lane's or unit's badge: the controller's outcome once it reported one,
 * else the compile estimate. The controller decides the channel cap, so an
 * official lane past it flips to `compat` and a lane the estimate put past
 * it may still get openDAW; an effect or page openDAW can't run is certain,
 * so an official outcome there is stale. Modulation reads it too.
 */
export function laneBackendBadge(
  estimate: Pick<LanePlan, "backend" | "fallback">,
  outcome: EffectsRuntimeOutcome | undefined
): BackendBadge | null {
  const certain =
    estimate.backend === "compat" && estimate.fallback !== "capacity";
  if (
    estimate.backend === null ||
    (outcome?.backend === "official" && !certain)
  ) {
    return null;
  }
  if (outcome?.backend === "bypass") {
    return { kind: "bypassed" };
  }
  if (outcome?.backend === "compatibility") {
    return { cause: outcome.fallback ?? estimate.fallback, kind: "compat" };
  }
  return estimate.backend === "compat"
    ? { cause: estimate.fallback, kind: "compat" }
    : null;
}

/** What an insert's effects are reconciled from. */
export type EffectsPlan = {
  layoutSignature: string;
  effects: readonly EffectConfig[];
};

export type EffectsSlotOptions<Plan extends EffectsPlan> = {
  /**
   * The layout that last went into the tree: a new insert's is its plan's,
   * as it is silent until it plays.
   */
  layout: string;
  /** The owner's lifetime: once it aborts, outcomes are no longer kept. */
  signal: AbortSignal;
  reconcile: (plan: Plan) => Promise<EffectsRuntimeOutcome>;
  /**
   * The first reconcile, when it also connects the insert (a unit's
   * attach); a lane's sound connects its own.
   */
  connect?: (plan: Plan) => Promise<EffectsRuntimeOutcome>;
  /** Writes one effect's fields in place; anything but applied reconciles. */
  writeFields?: (effectId: string, config: EffectConfig) => EffectWriteResult;
  /** An effect's fields were written in place. */
  fieldsWritten?: (effectId: string) => void;
  /** Ramps the insert's output to silence; null when nothing plays. */
  duck: () => Promise<void> | null;
  unduck: () => void;
  outcomeChanged: () => void;
  onFailure: (error: unknown) => void;
};

export class EffectsSlot<Plan extends EffectsPlan> {
  /** What its effects last settled on, as the controller reported. */
  outcome: EffectsRuntimeOutcome | undefined;
  /** The FX layout last in its tree, by layout signature; null if unknown. */
  private layout: string | null;
  /** Its effects changed since they were last reconciled. */
  private stale = true as boolean;
  private readonly pendingFields = new Set<string>();
  private ducked = false as boolean;
  /** Its next reconcile, until the first went: the connect, if any. */
  private reconcile: (plan: Plan) => Promise<EffectsRuntimeOutcome>;
  private readonly options: EffectsSlotOptions<Plan>;

  constructor(options: EffectsSlotOptions<Plan>) {
    this.options = options;
    this.layout = options.layout;
    this.reconcile = options.connect ?? options.reconcile;
  }

  /** Its effects changed; the next step reconciles. */
  changed(): void {
    this.stale = true;
  }

  /**
   * openDAW's channels came free: one it was too full for reconciles again
   * as its next step. Whether it will.
   */
  capacityFreed(): boolean {
    if (this.outcome?.fallback !== "capacity") {
      return false;
    }
    this.changed();
    return true;
  }

  /** One effect's fields changed, its layout kept; the next step writes them. */
  fieldsChanged(effectId: string): void {
    this.pendingFields.add(effectId);
  }

  /** The next step toward `plan`, or null once its effects match. */
  step(plan: Plan): Promise<void> | null {
    if (this.stale || (this.layout === null && this.pendingFields.size > 0)) {
      const swap = plan.layoutSignature !== this.layout;
      const ducking = swap && !this.ducked && this.options.duck();
      if (ducking) {
        this.ducked = true;
        return ducking;
      }
      this.stale = false;
      this.pendingFields.clear();
      this.layout = null;
      const { reconcile } = this;
      this.reconcile = this.options.reconcile;
      return reconcile(plan).then((outcome) => {
        if (!["failed", "superseded"].includes(outcome.status)) {
          this.layout = plan.layoutSignature;
        }
        this.record(outcome);
      }, this.options.onFailure);
    }
    if (this.pendingFields.size > 0) {
      return this.writePendingFields(plan);
    }
    if (this.ducked) {
      this.ducked = false;
      this.options.unduck();
    }
    return null;
  }

  private writePendingFields(plan: Plan): Promise<void> | null {
    const id = this.pendingFields.values().next().value;
    if (!id) {
      return null;
    }
    this.pendingFields.delete(id);
    const config = findEffectInTree(plan.effects, id);
    try {
      // An effect gone from the plan has nothing left to write; without a
      // writer, the whole tree reconciles.
      const result = config
        ? (this.options.writeFields?.(id, config) ?? "structural")
        : "applied";
      if (result === "applied") {
        this.options.fieldsWritten?.(id);
      } else {
        this.changed();
      }
    } catch {
      // A failed field transaction leaves the live graph behind the plan.
      this.changed();
    }
    return this.step(plan);
  }

  /**
   * Keeps what the controller reported. An inactive outcome means no
   * effects graph yet, so the estimate shows. A ready `bypass` only means
   * nothing was on to process (every FX off), not a dry fallback, so it is
   * not kept: switching an FX back on must not read `bypassed` while the
   * new runtime connects.
   */
  record(outcome: EffectsRuntimeOutcome): void {
    if (this.options.signal.aborted || outcome.status === "superseded") {
      return;
    }
    this.outcome =
      outcome.status === "inactive" ||
      (outcome.backend === "bypass" && outcome.status !== "failed")
        ? undefined
        : outcome;
    this.options.outcomeChanged();
  }
}
