/**
 * Node Routing Graph
 *
 * The part of a patch after the faders: graph units (FX chains that
 * several sources share, or that a branch takes on its own) and modules (a
 * sum, or a Filter or Pan off a source's strip), each a point with its own
 * cables out (sends.ts). Lanes reach it through their own sends
 * (node-lane-outputs), outputs through the engine's `routeSink`.
 *
 *   send → unit:   input → FX → duck → output → cables
 *          filter: filter → output → cables
 *          pan:    panner → output → cables
 *          sum:    one gain, its input and output → cables
 *
 * Each point is keyed by kind and id and follows the plan level-triggered:
 * a parameter edit updates it in place, a node that changes kind is a new
 * point, and a point the plan drops stops being wanted at once. It stays
 * while any cable into it still holds it, so a removed source's fade is
 * heard through shared FX. Once nothing holds it, its output fades and it
 * lets go of its own cables, which can release the next point in turn; a
 * point wanted again before then simply comes back. A point exists in Web
 * Audio from the first cable that reaches it, inside the play that brought
 * the audio, and a unit's FX attach then; until they are in, it plays
 * silent, as a lane's insert does.
 *
 * A cable that would close a loop with one still fading out (two points
 * swapping places) joins only once that one is gone, so a transition never
 * feeds back.
 */

import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import type { EffectWriteResult } from "@/lib/audio/manager/effects-graph-runtime";
import {
  LANE_DROP_MS,
  LANE_DUCK_MS,
  rampGain,
  type SendPlan,
  Sends,
  settleParam,
  delay as wait,
} from "@/lib/audio/routing/sends";
import { safeDisconnect, safeDisconnectFrom } from "@/lib/audio/utils";
import type { EffectsRuntimeOutcome } from "@/lib/channel-effects";
import {
  type CablePlan,
  type Endpoint,
  type EnginePlan,
  endpointKey,
  type ModulePlan,
  type UnitPlan,
} from "@/lib/node-graph/compile";
import { effectsChange } from "@/lib/node-graph/reconcile";
import { type EffectsBackend, EffectsSlot } from "./effects-slot";
import type { OwnerParameters } from "./params";

export type RoutingHost = {
  /** Connects a cable into an output; `realtime` skips the main delay. */
  routeSink: (sinkId: string, send: AudioNode, realtime: boolean) => () => void;
  /** Connects a unit's FX between its input and output, silent till ready. */
  attachEffects: (
    unitId: string,
    input: AudioNode,
    output: AudioNode,
    unit: UnitPlan
  ) => Promise<EffectsRuntimeOutcome>;
  reconcileEffects: (
    unitId: string,
    unit: UnitPlan
  ) => Promise<EffectsRuntimeOutcome>;
  /** Writes one of a unit's effects' fields in place. */
  setEffectFields: (
    unitId: string,
    effectId: string,
    config: EffectConfig
  ) => EffectWriteResult;
  /** Calls `listener` with each outcome a unit's effects report. */
  subscribeOutcome: (
    unitId: string,
    listener: (outcome: EffectsRuntimeOutcome) => void
  ) => () => void;
  /** A unit's transient parameter overlays, read from its latest plan. */
  parameters: (
    unitId: string,
    plan: () => UnitPlan,
    active: () => boolean
  ) => OwnerParameters;
  /** A cable's transient level while one overlays it. */
  sendOverlay: (cable: CablePlan) => number | undefined;
  detachEffects: (unitId: string) => void;
  /** A unit's effects backend changed. */
  outcomeChanged: () => void;
  onFailure: (error: unknown) => void;
  wait?: (ms: number) => Promise<void>;
};

/**
 * A cable as its sender's send: where it goes, its level and its delay.
 * A transient overlay replaces its gain; its mute still silences it.
 */
export function sendPlan(
  cable: CablePlan,
  realtime: boolean,
  overlay?: number
): SendPlan {
  return {
    delay: cable.delay,
    level: cable.muted ? 0 : (overlay ?? cable.gain),
    realtime,
    reenters: cable.reenters,
    to: endpointKey(cable.to),
  };
}

/** A point's Web Audio nodes, from the first cable that reached it. */
type Live = {
  readonly context: BaseAudioContext;
  /** Where its cables in connect, and sum. */
  readonly input: AudioNode;
  /** Its retirement fade, where its cables out start. */
  readonly output: GainNode;
  /** A unit's layout duck, where its FX end. */
  readonly duck: GainNode | null;
  readonly sends: Sends;
  readonly effects: EffectsSlot<UnitPlan> | null;
  /** A unit's transient parameter overlays. */
  readonly parameters: OwnerParameters | null;
  readonly controller: AbortController;
  /** Cables into it still connected. */
  holds: number;
  /** Its output faded out: it goes once the fade ends, if still unheld. */
  fading: boolean;
};

type PointPlan = UnitPlan | ModulePlan;

type Point = {
  readonly key: string;
  plan: PointPlan;
  /** Its cables out: the plan's while wanted, the last ones after. */
  cables: CablePlan[];
  wanted: boolean;
  live: Live | null;
  /** The step its driver waits on. */
  waiting: Promise<void> | null;
};

function unitEffectsId(unitId: string): string {
  return `node-unit:${unitId}`;
}

function isUnit(plan: PointPlan): plan is UnitPlan {
  return !("kind" in plan);
}

function setFilter(
  filter: BiquadFilterNode,
  plan: Extract<ModulePlan, { kind: "filter" }>["filter"],
  smooth: boolean
): void {
  filter.type = plan.type;
  if (smooth) {
    settleParam(filter.frequency, filter.context, plan.frequency);
    settleParam(filter.Q, filter.context, plan.Q);
  } else {
    filter.frequency.value = plan.frequency;
    filter.Q.value = plan.Q;
  }
}

export class RoutingGraph {
  private readonly points = new Map<string, Point>();
  private readonly host: RoutingHost;
  private readonly wait: (ms: number) => Promise<void>;

  constructor(host: RoutingHost) {
    this.host = host;
    this.wait = host.wait ?? wait;
  }

  /** Takes the plan's points and cables; what it dropped retires. */
  apply(plan: EnginePlan): void {
    const wanted = new Map<string, PointPlan>();
    for (const unit of plan.units.values()) {
      wanted.set(endpointKey({ id: unit.id, kind: "unit" }), unit);
    }
    for (const module of plan.modules.values()) {
      wanted.set(endpointKey(module), module);
    }
    const cables = new Map<string, CablePlan[]>();
    for (const cable of plan.cables.values()) {
      const key = endpointKey(cable.from);
      cables.set(key, [...(cables.get(key) ?? []), cable]);
    }
    for (const point of this.points.values()) {
      if (!wanted.has(point.key)) {
        point.wanted = false;
        this.kick(point);
      }
    }
    // Every wanted point is there before any cable reaches for one.
    const changed: [Point, PointPlan][] = [];
    for (const [key, next] of wanted) {
      const point = this.points.get(key) ?? {
        cables: [],
        key,
        live: null,
        plan: next,
        waiting: null,
        wanted: true,
      };
      this.points.set(key, point);
      changed.push([point, point.plan]);
      point.plan = next;
      point.cables = cables.get(key) ?? [];
      point.wanted = true;
    }
    // Every cable that went starts fading before a new one looks for loops.
    for (const [point] of changed) {
      point.live?.sends.retire(this.sendPlans(point));
    }
    for (const [point, previous] of changed) {
      const { live } = point;
      if (live) {
        this.revive(live);
        this.update(live, previous, point.plan);
        this.settleSends(point, live);
      }
      this.kick(point);
    }
  }

  /**
   * Connects `send` into the point `to` and holds it there until the
   * returned release. A point that is gone takes nothing. A send from
   * point `from` that would close a loop through a cable still fading out
   * joins once that cable is gone; the point is held meanwhile.
   */
  private hold(to: Endpoint, send: AudioNode, from?: string): () => void {
    const point = this.points.get(endpointKey(to));
    if (!point) {
      return () => undefined;
    }
    const live = this.materialize(point, send.context);
    live.holds += 1;
    this.revive(live);
    let joined = false;
    // A send let go while it waits must not join after.
    let released = false;
    const join = () => {
      if (released || point.live !== live) {
        return;
      }
      const blockers = from === undefined ? [] : this.loopsBack(point, from);
      if (blockers.length > 0) {
        Promise.all(blockers).then(join, join);
        return;
      }
      send.connect(live.input);
      joined = true;
    };
    join();
    // A unit just made attaches its effects as its first step.
    this.kick(point);
    return () => {
      released = true;
      if (joined) {
        safeDisconnectFrom(send, live.input, "RoutingGraph.release");
      }
      live.holds -= 1;
      if (point.live === live) {
        this.kick(point);
      }
    };
  }

  /**
   * Connects a send into what `to` (an endpoint key) names: an output, or
   * a point it holds. A point's own sends name it in `from`.
   */
  route(
    to: string,
    send: AudioNode,
    realtime: boolean,
    from?: string
  ): () => void {
    const [kind, ...rest] = to.split(":");
    const id = rest.join(":");
    return kind === "sink"
      ? this.host.routeSink(id, send, realtime)
      : this.hold({ id, kind: kind as Endpoint["kind"] }, send, from);
  }

  /** Units whose effects `affects` matches reconcile again, e.g. a new key. */
  effectsChanged(affects: (unit: UnitPlan) => boolean): void {
    for (const point of this.points.values()) {
      const { live, plan } = point;
      if (live?.effects && isUnit(plan) && point.wanted && affects(plan)) {
        live.effects.changed();
        this.kick(point);
      }
    }
  }

  /** The backend a unit's effects settled on, while it runs. */
  outcomeOf(unitId: string): EffectsBackend | undefined {
    return this.points.get(endpointKey({ id: unitId, kind: "unit" }))?.live
      ?.effects?.outcome;
  }

  /** A wanted unit's transient parameters, while it runs. */
  parametersOf(unitId: string): OwnerParameters | undefined {
    const point = this.points.get(endpointKey({ id: unitId, kind: "unit" }));
    return (point?.wanted && point.live?.parameters) || undefined;
  }

  /** Whether a wanted point's send of `cableId` takes a transient level. */
  sendsAvailable(from: Endpoint, cableId: string): boolean {
    const point = this.points.get(endpointKey(from));
    return Boolean(
      point?.wanted &&
        point.live &&
        (point.live.parameters?.available({ edgeId: cableId, kind: "send" }) ??
          true)
    );
  }

  /** The point's sends take their levels again, e.g. a new overlay. */
  refreshSends(from: Endpoint): void {
    const point = this.points.get(endpointKey(from));
    if (point?.live) {
      this.settleSends(point, point.live);
    }
  }

  /** Every unit drops its transient overlays; every send takes its plan. */
  clearTransient(): void {
    for (const point of this.points.values()) {
      if (point.live) {
        point.live.parameters?.clear();
        this.settleSends(point, point.live);
      }
    }
  }

  busy(): boolean {
    return [...this.points.values()].some((point) => point.waiting !== null);
  }

  /** Nothing is wanted any more: each point goes once nothing holds it. */
  dispose(): void {
    for (const point of this.points.values()) {
      point.wanted = false;
      this.kick(point);
    }
  }

  /** Resolves once every point's driver is done, released ones included. */
  async whenIdle(): Promise<void> {
    while (this.busy()) {
      // biome-ignore lint/performance/noAwaitInLoops: a release can start the next point's fade.
      await Promise.allSettled(
        [...this.points.values()].map((point) => point.waiting)
      );
    }
  }

  /**
   * The fading cables a send from `from` into `point` would close a loop
   * through: none when it closes no loop.
   */
  private loopsBack(point: Point, from: string): Promise<void>[] {
    const fading: Promise<void>[] = [];
    const seen = new Set<string>();
    const queue = [point.key];
    let closes = false;
    for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
      closes ||= key === from;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      for (const edge of this.points.get(key)?.live?.sends.edges() ?? []) {
        if (edge.gone) {
          fading.push(edge.gone);
        }
        queue.push(edge.to);
      }
    }
    return closes ? fading : [];
  }

  /** The point's nodes in `context`, made the first time audio reaches it. */
  private materialize(point: Point, context: BaseAudioContext): Live {
    const current = point.live;
    if (current?.context === context) {
      return current;
    }
    // Audio from a context since replaced: the old nodes carry nothing.
    if (current) {
      this.release(point, current);
    }
    const audio = context as AudioContext;
    const { plan } = point;
    const output = audio.createGain();
    let input: AudioNode = output;
    let duck: GainNode | null = null;
    const controller = new AbortController();
    let effects: EffectsSlot<UnitPlan> | null = null;
    let parameters: OwnerParameters | null = null;
    if (isUnit(plan)) {
      const unitInput = audio.createGain();
      const unitDuck = audio.createGain();
      unitDuck.connect(output);
      input = unitInput;
      duck = unitDuck;
      const id = unitEffectsId(plan.id);
      // A point keeps its kind: a unit's plan stays a unit's.
      const latest = () => point.plan as UnitPlan;
      const overlays = this.host.parameters(
        id,
        latest,
        () => point.wanted && !controller.signal.aborted
      );
      parameters = overlays;
      const slot = new EffectsSlot<UnitPlan>({
        connect: (next) =>
          this.host.attachEffects(id, unitInput, unitDuck, next),
        duck: () => {
          rampGain(unitDuck, 0);
          return this.wait(LANE_DUCK_MS);
        },
        fieldsWritten: (effectId) => overlays.reapply({ effectId }),
        layout: plan.layoutSignature,
        onFailure: this.host.onFailure,
        outcomeChanged: () => this.host.outcomeChanged(),
        reconcile: (next) => this.host.reconcileEffects(id, next),
        signal: controller.signal,
        unduck: () => rampGain(unitDuck, 1),
        writeFields: (effectId, config) =>
          this.host.setEffectFields(id, effectId, config),
      });
      effects = slot;
      // A fallback after the unit settled: its badge, overlays and sends
      // follow the backend it fell back to.
      controller.signal.addEventListener(
        "abort",
        this.host.subscribeOutcome(id, (outcome) => {
          slot.record(outcome);
          overlays.reapply();
          if (point.live) {
            this.settleSends(point, point.live);
          }
        })
      );
    } else if (plan.kind === "filter") {
      const filter = audio.createBiquadFilter();
      setFilter(filter, plan.filter, false);
      filter.connect(output);
      input = filter;
    } else if (plan.kind === "pan") {
      const panner = audio.createStereoPanner();
      panner.pan.value = plan.pan;
      panner.connect(output);
      input = panner;
    }
    const live: Live = {
      context,
      controller,
      duck,
      effects,
      fading: false,
      holds: 0,
      input,
      output,
      parameters,
      sends: new Sends(
        output,
        (to, send, realtime) => this.route(to, send, realtime, point.key),
        this.wait
      ),
    };
    point.live = live;
    this.settleSends(point, live);
    return live;
  }

  /**
   * A live point takes its new parameters in place; a unit's effects
   * change as a lane's would, by field writes when that is all it takes.
   */
  private update(live: Live, previous: PointPlan, next: PointPlan): void {
    if (isUnit(next)) {
      const change = isUnit(previous) ? effectsChange(previous, next) : null;
      if (change?.kind === "fields") {
        for (const effectId of change.effectIds) {
          live.effects?.fieldsChanged(effectId);
        }
      } else if (change) {
        live.effects?.changed();
      }
    } else if (next.kind === "filter") {
      setFilter(live.input as BiquadFilterNode, next.filter, true);
    } else if (next.kind === "pan") {
      const { pan } = live.input as StereoPannerNode;
      settleParam(pan, live.context, next.pan);
    }
  }

  /** A point wanted or held again while it fades comes back. */
  private revive(live: Live): void {
    if (live.fading) {
      live.fading = false;
      rampGain(live.output, 1);
    }
  }

  private sendPlans(point: Point): Map<string, SendPlan> {
    return new Map(
      point.cables.map((cable) => [
        cable.id,
        sendPlan(cable, point.plan.realtime, this.host.sendOverlay(cable)),
      ])
    );
  }

  /** One send per cable out of the point, each ramped to its level. */
  private settleSends(point: Point, live: Live): void {
    live.sends.settle(this.sendPlans(point));
  }

  private kick(point: Point): void {
    if (!point.waiting) {
      this.drive(point);
    }
  }

  /**
   * Takes each step toward what is wanted: an unheld point no longer
   * wanted fades its output, and goes once the fade ends if it is still
   * neither wanted nor held; a unit reconciles its effects.
   */
  private drive(point: Point): void {
    for (;;) {
      const { live } = point;
      if (!live) {
        this.forget(point);
        return;
      }
      let step: Promise<void> | null;
      if (point.wanted || live.holds > 0) {
        step =
          live.effects && isUnit(point.plan)
            ? live.effects.step(point.plan)
            : null;
        if (!step) {
          return;
        }
      } else if (live.fading) {
        this.release(point, live);
        continue;
      } else {
        live.fading = true;
        rampGain(live.output, 0);
        step = this.wait(LANE_DROP_MS);
      }
      const next = () => {
        point.waiting = null;
        this.drive(point);
      };
      point.waiting = step.then(next, next);
      return;
    }
  }

  /** Lets go of the point's nodes and cables; the plan may make it again. */
  private release(point: Point, live: Live): void {
    live.controller.abort();
    point.live = null;
    live.sends.drop();
    if (live.effects && isUnit(point.plan)) {
      this.host.detachEffects(unitEffectsId(point.plan.id));
      this.host.outcomeChanged();
    }
    safeDisconnect(live.input, "RoutingGraph.release");
    safeDisconnect(live.duck, "RoutingGraph.release");
    safeDisconnect(live.output, "RoutingGraph.release");
  }

  /** A point neither wanted nor live is dropped from the graph. */
  private forget(point: Point): void {
    if (!point.wanted && this.points.get(point.key) === point) {
      this.points.delete(point.key);
    }
  }
}
