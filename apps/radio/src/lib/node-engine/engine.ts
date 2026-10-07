/**
 * Node Engine
 *
 * Plays one activation of a Node patch. Each compiled plan is diffed
 * against the last and applied to one `LaneSlot` per lane (lane.ts), which
 * owns that lane's sound from its restore to its release, and to the
 * routing graph (routing.ts), which owns the units and modules after the
 * faders. The engine owns what they share: the lane outputs and Output
 * device sinks their cables reach, the headphone cue output, the master
 * volume, the FX badges, the stream budget and Play all. `dispose` refuses
 * new starts, retires every lane and waits for each to release, then for
 * the routing graph to let go, before it closes the rest; the next
 * activation builds a new engine.
 *
 * Each lane reaches its cables through its own `laneOut` gain
 * (node-lane-outputs), registered as the sound's output connector before it
 * first plays, which fans out into one send per cable. Every cable into an
 * output goes through that Output node's own gain (node-device-sinks),
 * which carries its mute and the master volume, so Node's master acts
 * after every effect, at the outputs, for cables still fading out too; the
 * faders don't take it. Speakers play on the main bus, an Output device on
 * its device, or on the main bus while that device can't play. A lane
 * ducks laneOut around its own FX layout swaps.
 */

import { Store } from "@tanstack/react-store";
import type { Radio } from "@/lib/audio";
import { DEFAULT_EFFECT_TEMPO } from "@/lib/audio/dsp/effects/tempo";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  isEffectContainer,
  normalizeEffectTree,
} from "@/lib/audio/dsp/routing/effect-tree";
import type { AudioManager } from "@/lib/audio/manager/audio-manager";
import type {
  DeviceSinkStatus,
  NodeDeviceSinks,
  NodeDeviceSinksOptions,
} from "@/lib/audio/routing/node-device-sinks";
import type {
  NodeLaneOutputs,
  NodeLaneOutputsOptions,
} from "@/lib/audio/routing/node-lane-outputs";
import type { SendPlan } from "@/lib/audio/routing/sends";
import { findSidechainChannelId } from "@/lib/channel-effects";
import type {
  CablePlan,
  Endpoint,
  EnginePlan,
  LaneBackend,
} from "@/lib/node-graph/compile";
import { diff, type Op } from "@/lib/node-graph/reconcile";
import { MAX_EDGE_GAIN } from "@/lib/node-graph/schema";
import type { OutputRouting } from "@/lib/output-routing.js";
import {
  type ResolvePlatformStream,
  radioOnTrack,
} from "@/lib/platform-stream-refresh";
import {
  getPlaybackChannelRuntime,
  getPlaybackRuntimeChannelIds,
  resetPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import {
  cleanupOrphanedSounds,
  getRuntimeSoundIds,
} from "../mode-lifecycle-cleanup.js";
import type { PlaybackActionContext } from "../playback-action-context.js";
import {
  cleanupManagedChannel,
  runWithConcurrency,
} from "../playback-actions-shared.js";
import {
  type EffectsBackend,
  type LaneHost,
  LaneSlot,
  reportNodeFailure,
  type StartResult,
} from "./lane.js";
import { clampParam, type EngineParamTarget } from "./param-target.js";
import { createParameters } from "./params.js";
import { RoutingGraph, sendPlan } from "./routing.js";

/**
 * What an FX node's badge says. None while its lane runs as planned or has
 * no effects runtime; `compat` on the compatibility worklet; `bypassed`
 * when the controller fell back dry.
 */
export type BackendBadge = "compat" | "bypassed";

/** Badges by node id: each lane's, and each enabled FX node's in it. */
export type NodeBackendBadges = Readonly<Record<string, BackendBadge>>;

export type NodeBackendBadgeStore = Store<NodeBackendBadges>;

export const nodeBackendBadges: NodeBackendBadgeStore =
  new Store<NodeBackendBadges>({});

/** Each Output device node's sink status, by node id, for its body. */
export type NodeSinkStatuses = Readonly<Record<string, DeviceSinkStatus>>;

export type NodeSinkStatusStore = Store<NodeSinkStatuses>;

export const nodeSinkStatuses: NodeSinkStatusStore =
  new Store<NodeSinkStatuses>({});

/**
 * A lane's badge: the controller's outcome once it reported one, else the
 * compile estimate. The estimate is only displayed; the controller decides,
 * so an official lane past the runtime cap flips to `compat`.
 */
export function laneBackendBadge(
  estimate: LaneBackend | null,
  outcome: EffectsBackend | undefined
): BackendBadge | null {
  if (estimate === null || outcome === "official") {
    return null;
  }
  if (outcome === "bypass") {
    return "bypassed";
  }
  return outcome === "compatibility" || estimate === "compat" ? "compat" : null;
}

/** Enabled effect ids in a lane's tree, containers' chains included. */
function enabledEffectIds(effects: readonly EffectConfig[]): string[] {
  return effects.flatMap((effect) => {
    if (!effect.enabled) {
      return [];
    }
    return isEffectContainer(effect)
      ? [
          effect.id,
          ...effect.chains.flatMap((chain) => enabledEffectIds(chain.effects)),
        ]
      : [effect.id];
  });
}

function sameBadges(left: NodeBackendBadges, right: NodeBackendBadges) {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  );
}

export type NodeEngineOptions = {
  ctx: PlaybackActionContext;
  /** Where lane backend badges are published for the canvas and Rack. */
  backendBadges: NodeBackendBadgeStore;
  /** Where Output device sink statuses are published for their bodies. */
  sinkStatuses: NodeSinkStatusStore;
  /**
   * The main bus units and modules play into, and the headphone cue bus a
   * Track's or File's cue listen taps into. The cue settings are applied
   * as a tap goes on, as a DJ deck's CUE does, since Node mode alone never
   * builds the cue output.
   */
  outputRouting: () => Pick<
    OutputRouting,
    "applySettings" | "connectMain" | "registerCueDeck" | "releaseCue"
  >;
  /** Node's master volume, applied at every Output node. */
  masterVolume: () => number;
  deviceSinks: (options: NodeDeviceSinksOptions) => NodeDeviceSinks;
  laneOutputs: (options: NodeLaneOutputsOptions) => NodeLaneOutputs;
  /** Where lanes and units reconcile their effects; AudioManager's. */
  effects: Pick<
    AudioManager,
    | "attachEffectsInsert"
    | "connectEffectsKey"
    | "detachEffectsInsert"
    | "reconcileEffects"
    | "releaseEffectsKey"
    | "setEffectFields"
    | "subscribeEffectsRuntimeOutcome"
  >;
  fadeOut: (soundId: string) => Promise<void>;
  /** Renews an expired platform stream, or resolves a `yt:` track. */
  resolveStream: ResolvePlatformStream;
  /** How many streams may play at once here. */
  streamLimit: () => number;
  /** Commits `radio` into a lane's source, while it still holds `from`. */
  commitTrack: (laneId: string, from: Radio, radio: Radio) => boolean;
};

export type NodeEngine = ReturnType<typeof createNodeEngine>;

const PLAY_ALL_CONCURRENCY = 3;
const NODE_CHANNEL_PREFIX = "n:";
const EMPTY_PLAN: EnginePlan = {
  cables: new Map(),
  issues: [],
  lanes: new Map(),
  modules: new Map(),
  monitoringChannels: 0,
  sinks: new Map(),
  units: new Map(),
};

function warn(message: string) {
  return (error: unknown) => console.warn(`[NodePlayback] ${message}`, error);
}

export function createNodeEngine(options: NodeEngineOptions) {
  const { ctx } = options;
  const slots = new Map<string, LaneSlot>();
  /**
   * A send's transient level, by cable id, wherever the cable leaves from:
   * kept while the cable is in the plan, a move to a new sender included.
   */
  const sendOverlays = new Map<string, number>();
  let plan = EMPTY_PLAN;
  let disposing = false;
  /** The latest Play all; a pause or a newer Play all stops it. */
  let playAll: AbortController | null = null;
  /** Whether a tap opened the cue output. */
  let cueOpened = false;
  /** Lane failures an activation collects to rethrow. */
  let failures: unknown[] | null = null;

  const liveSlot = (laneId: string) => {
    const slot = slots.get(laneId);
    return slot?.plan && !disposing ? slot : undefined;
  };

  /** A lane's sound that is not on its way out. */
  const liveInstance = (laneId: string) => {
    const instance = slots.get(laneId)?.current;
    return instance && !instance.retiring ? instance : undefined;
  };

  /** The transient parameters of a lane's sound or a graph unit. */
  const parametersOf = (ownerId: string) =>
    liveInstance(ownerId)?.parameters ?? routing.parametersOf(ownerId);

  /** Whether the cable's sender takes a transient level for it now. */
  const sendAvailable = (cable: CablePlan): boolean =>
    cable.from.kind === "lane"
      ? Boolean(
          liveInstance(cable.from.id)?.parameters.available({
            edgeId: cable.id,
            kind: "send",
          })
        )
      : routing.sendsAvailable(cable.from, cable.id);

  /** A cable's overlay, while its sender takes one. */
  const sendOverlay = (cable: CablePlan): number | undefined =>
    sendAvailable(cable) ? sendOverlays.get(cable.id) : undefined;

  /** Only a cable still in the plan keeps its overlay. */
  const keepSendOverlays = (next: EnginePlan) => {
    for (const cableId of sendOverlays.keys()) {
      if (!next.cables.has(cableId)) {
        sendOverlays.delete(cableId);
      }
    }
  };

  /** The cable's sender takes its sends' levels again. */
  const refreshSender = (from: Endpoint) => {
    if (from.kind !== "lane") {
      routing.refreshSends(from);
    } else if (liveInstance(from.id)) {
      laneOutputs.refresh(from.id);
    }
  };

  /** The lane's sends: one per cable leaving it. */
  const laneSends = (laneId: string) => {
    const sends = new Map<string, SendPlan>();
    // A live input's lane skips the main delay.
    const realtime = plan.lanes.get(laneId)?.source.kind === "device";
    for (const cable of plan.cables.values()) {
      if (cable.from.kind === "lane" && cable.from.id === laneId) {
        sends.set(cable.id, sendPlan(cable, realtime, sendOverlay(cable)));
      }
    }
    return sends;
  };

  /**
   * Every Output node plays through its own gain: its mute and the master
   * volume, after every effect, for the cables still fading in too.
   */
  const deviceSinks = options.deviceSinks({
    connectMain: (node, realtime) =>
      options.outputRouting().connectMain(node, realtime),
    isActive: () => !disposing,
    onStatus: () => options.sinkStatuses.setState(() => deviceSinks.statuses()),
  });

  /**
   * The tree an insert's effects are reconciled with. Each keyed effect
   * names its key; the compatibility engine binds the first one's.
   */
  const desiredEffects = (effects: readonly EffectConfig[]) => ({
    dryWet: 1,
    sidechainSoundId: findSidechainChannelId(effects),
    tempo: DEFAULT_EFFECT_TEMPO,
    tree: normalizeEffectTree(effects),
  });

  const routing = new RoutingGraph({
    attachEffects: (id, input, output, unit) =>
      options.effects.attachEffectsInsert(
        id,
        input,
        output,
        desiredEffects(unit.effects)
      ),
    connectKey: (id, input) => options.effects.connectEffectsKey(id, input),
    detachEffects: (id) => options.effects.detachEffectsInsert(id),
    onFailure: reportNodeFailure("Could not apply shared effects"),
    outcomeChanged: () => publishBadges(),
    parameters: (id, unit, active) =>
      createParameters({
        active,
        audio: ctx.audio,
        effects: options.effects,
        plan: unit,
        soundId: id,
      }),
    reconcileEffects: (id, unit) =>
      options.effects.reconcileEffects(id, desiredEffects(unit.effects)),
    releaseKey: (id) => options.effects.releaseEffectsKey(id),
    routeSink: (sinkId, send, realtime) =>
      deviceSinks.connect(sinkId, send, realtime),
    sendOverlay,
    setEffectFields: (id, effectId, config) =>
      options.effects.setEffectFields(id, effectId, config),
    subscribeOutcome: (id, listener) =>
      options.effects.subscribeEffectsRuntimeOutcome(id, listener),
  });

  const laneOutputs = options.laneOutputs({
    getHost: () => ctx.audio,
    getSends: laneSends,
    // A new sound's nodes exist from its connect, before its playback and
    // its effects start; the keys they may listen to are made first.
    onConnect: (laneId, context) => {
      routing.reserveKeys(context);
      slots.get(laneId)?.current?.applyStrip();
    },
    // A lane's send goes to an output, or into a unit or module it holds.
    route: (to, send, realtime) => routing.route(to, send, realtime),
  });

  /** Writes every lane's badge, and its FX nodes', when one changed. */
  const publishBadges = () => {
    const badges: Record<string, BackendBadge> = {};
    for (const lane of plan.lanes.values()) {
      const badge = laneBackendBadge(
        lane.backend,
        liveInstance(lane.id)?.effects.outcome
      );
      if (!badge) {
        continue;
      }
      badges[lane.id] = badge;
      for (const id of enabledEffectIds(lane.effects)) {
        badges[id] = badge;
      }
    }
    for (const unit of plan.units.values()) {
      const badge = laneBackendBadge(unit.backend, routing.outcomeOf(unit.id));
      if (badge) {
        for (const id of enabledEffectIds(unit.effects)) {
          badges[id] = badge;
        }
      }
    }
    if (!sameBadges(options.backendBadges.state, badges)) {
      options.backendBadges.setState(() => badges);
    }
  };

  const host: LaneHost = {
    commitTrack: options.commitTrack,
    ctx,
    cueTap: (laneId, tap) => {
      const output = options.outputRouting();
      cueOpened = true;
      const registration = output.registerCueDeck(`node:${laneId}`, tap, true);
      // The cue sink exists only once the stored cue output is applied; the
      // tap connects to it then.
      output.applySettings().catch(warn("Could not open the cue output"));
      return registration;
    },
    fadeOut: options.fadeOut,
    // The driver is done with the slot: only one still in use is kept.
    idle: (slot) => {
      if (!(slot.plan || slot.current)) {
        slots.delete(slot.laneId);
      }
    },
    laneFailed: (slot, error) =>
      failures ? failures.push(error) : slot.fail(error),
    laneOutputs,
    outcomeChanged: publishBadges,
    /** A lane's effects as its plan has them. Node has no dry/wet or tempo control. */
    reconcileEffects: (soundId, lane) =>
      options.effects.reconcileEffects(soundId, desiredEffects(lane.effects)),
    resolveStream: options.resolveStream,
    setEffectFields: (...args) => options.effects.setEffectFields(...args),
    streamLimit: (slot) => {
      if (slot.plan?.source.kind === "device") {
        return null;
      }
      const limit = options.streamLimit();
      let busy = 0;
      for (const other of slots.values()) {
        if (other !== slot && other.busyStream()) {
          busy += 1;
        }
      }
      return busy >= limit ? limit : null;
    },
    subscribeEffectsRuntimeOutcome: (...args) =>
      options.effects.subscribeEffectsRuntimeOutcome(...args),
  };

  /**
   * Matches the Output node gains to the plan's outputs, at the master
   * volume. A removed output keeps its gain, and its mute, until the cables
   * into it faded out; that gain follows the master too.
   */
  const syncSinks = (next: EnginePlan) => {
    deviceSinks.sync(
      new Map(
        [...next.sinks.values()].map((sink) => [
          sink.id,
          {
            muted: sink.muted ?? false,
            ...(sink.type === "deviceOut"
              ? { deviceId: sink.deviceId ?? null }
              : {}),
          },
        ])
      ),
      options.masterVolume()
    );
  };

  /**
   * Every lane's cables take their levels. A removed or replaced lane
   * keeps its old cables through its fade-out; the new stream's laneOut
   * reads its cables as it connects.
   */
  const refreshLanes = (removed: ReadonlySet<string>) => {
    for (const laneId of plan.lanes.keys()) {
      if (!(removed.has(laneId) || slots.get(laneId)?.current?.retiring)) {
        laneOutputs.refresh(laneId);
      }
    }
  };

  const applyParam = (op: Extract<Op, { type: "setParam" }>) => {
    const lane = plan.lanes.get(op.id);
    if (!lane) {
      return;
    }
    const { channelId } = lane;
    const instance = liveInstance(lane.id);
    switch (op.param) {
      // On the lane's live sound only: a sound fading out keeps its level,
      // and its successor takes the plan's as it is made.
      case "volume":
        // A muted sound's gain is its mute; the cache already holds the value.
        if (instance && !lane.muted) {
          ctx.channels.setVolume("node", channelId, op.value);
        }
        break;
      case "muted":
        if (!instance) {
          break;
        }
        ctx.channels.setMuted("node", channelId, op.value);
        if (!op.value) {
          // The engine restores its own pre-mute gain, which is unset for a
          // sound created muted; re-apply the Station volume.
          ctx.channels.setVolume("node", channelId, lane.volume);
        }
        break;
      case "pan":
      case "filter":
        // On the sound's nodes, paused too, so a resume starts on it.
        instance?.applyStrip();
        break;
      case "cueListen":
        // The tap lives on the sound's nodes, which exist once it plays.
        if (getPlaybackChannelRuntime(channelId).isPlaying) {
          instance?.syncCueTap();
        }
        break;
      case "transport":
        instance?.applyTransport();
        break;
      case "channelSelection":
        instance?.applyChannels();
        break;
      default: {
        const exhaustive: never = op;
        return exhaustive;
      }
    }
  };

  const applyOp = (op: Op) => {
    switch (op.type) {
      // Lanes took their plans before their ops apply.
      case "addLane":
      case "removeLane":
        break;
      // A new layout swaps, ducked, as the lane's driver reconciles it.
      case "setLaneEffects":
      case "replaceLaneEffects":
        slots.get(op.laneId)?.effectsChanged();
        break;
      case "setEffectFields":
        slots.get(op.laneId)?.setEffectFields(op.effectId);
        break;
      case "setParam":
        applyParam(op);
        break;
      default: {
        const exhaustive: never = op;
        return exhaustive;
      }
    }
  };

  const engine = {
    /**
     * Applies `next`. `strict` (activation) rethrows the first lane that
     * could not be made; otherwise that lane shows its error.
     */
    apply(next: EnginePlan, strict: boolean) {
      const previous = plan;
      const ops = diff(previous, next);
      plan = next;
      keepSendOverlays(next);
      const removed = new Set(
        ops.flatMap((op) => (op.type === "removeLane" ? [op.laneId] : []))
      );
      const collected: unknown[] = [];
      failures = strict ? collected : null;
      try {
        // Every lane takes its plan, a removed one released first; a lane
        // removed and added back in one commit is replaced.
        for (const laneId of removed) {
          if (!next.lanes.has(laneId)) {
            slots.get(laneId)?.remove();
          }
        }
        for (const [laneId, lane] of next.lanes) {
          const slot = slots.get(laneId);
          if (slot) {
            slot.update(lane, removed.has(laneId));
          } else {
            const added = new LaneSlot(host, lane);
            slots.set(laneId, added);
            added.kick();
          }
        }
        syncSinks(next);
        // Points exist before a lane's cable reaches for one.
        routing.apply(next);
        refreshLanes(removed);
        for (const op of ops) {
          try {
            applyOp(op);
          } catch (error) {
            warn(`Could not apply ${op.type}`)(error);
          }
        }
      } finally {
        failures = null;
        publishBadges();
      }
      if (collected.length > 0) {
        throw collected[0];
      }
    },
    busy: (): boolean =>
      routing.busy() || [...slots.values()].some((slot) => slot.busy()),
    clearTransient(target?: EngineParamTarget) {
      if (target?.kind === "send") {
        sendOverlays.delete(target.edgeId);
        const from = plan.cables.get(target.edgeId)?.from;
        if (from) {
          refreshSender(from);
        }
      } else if (target) {
        parametersOf(target.laneId)?.clear(target);
      } else {
        sendOverlays.clear();
        for (const slot of slots.values()) {
          if (!slot.current?.retiring) {
            slot.current?.parameters.clear();
            laneOutputs.refresh(slot.laneId);
          }
        }
        routing.clearTransient();
      }
    },
    async dispose() {
      disposing = true;
      playAll?.abort();
      const soundIds = new Set<string>();
      for (const slot of slots.values()) {
        if (slot.current) {
          soundIds.add(slot.current.soundId);
        }
        slot.remove();
      }
      await engine.whenSettled();
      routing.dispose();
      await routing.whenIdle();
      // Whatever else holds an `n:*` channel goes too, before the orphan check.
      const channelIds = getPlaybackRuntimeChannelIds().filter((id) =>
        id.startsWith(NODE_CHANNEL_PREFIX)
      );
      for (const soundId of getRuntimeSoundIds(channelIds)) {
        soundIds.add(soundId);
      }
      for (const channelId of channelIds) {
        cleanupManagedChannel(channelId, ctx);
        resetPlaybackChannelRuntime(channelId);
      }
      // The cue output a tap opened closes with the mode, as DJ's does.
      if (cueOpened) {
        cueOpened = false;
        try {
          options.outputRouting().releaseCue();
        } catch (error) {
          warn("Could not close the cue output")(error);
        }
      }
      laneOutputs.dispose();
      deviceSinks.dispose();
      options.sinkStatuses.setState(() => deviceSinks.statuses());
      plan = EMPTY_PLAN;
      sendOverlays.clear();
      publishBadges();
      cleanupOrphanedSounds([...soundIds], ctx, "node");
    },
    /** Node's master volume changed: every Output node's gain follows. */
    masterVolumeChanged() {
      syncSinks(plan);
    },
    pause(laneId: string) {
      slots.get(laneId)?.pause(true);
    },
    pauseAll() {
      playAll?.abort();
      for (const slot of slots.values()) {
        slot.pause();
      }
    },
    get plan() {
      return plan;
    },
    play(laneId: string): Promise<StartResult> {
      return liveSlot(laneId)?.play() ?? Promise.resolve("cancelled");
    },
    /** Plays every Station, Track and File, at most 3 starts at a time. */
    async playAll() {
      playAll?.abort();
      const run = new AbortController();
      playAll = run;
      // Streams only: a mic goes live from its own Go live, never in bulk.
      const targets = [...plan.lanes.values()].filter(
        (lane) =>
          lane.source.kind !== "device" &&
          !getPlaybackChannelRuntime(lane.channelId).isPlaying
      );
      await runWithConcurrency(
        targets,
        PLAY_ALL_CONCURRENCY,
        async (lane) => {
          await engine.play(lane.id);
        },
        () => !(run.signal.aborted || disposing)
      );
    },
    /** Moves a Track or File to one of its tracks and plays it. */
    playTrack(laneId: string, streamUrl: string): Promise<StartResult> {
      const slot = liveSlot(laneId);
      const radio = plan.lanes.get(laneId)?.radio as Radio | undefined;
      if (!(slot && radio)) {
        return Promise.resolve("cancelled");
      }
      return slot.playTrack(
        () => radioOnTrack(radio, streamUrl, options.resolveStream),
        "Couldn't load this track"
      );
    },
    retryOutputDevice(sinkId: string) {
      if (!disposing && plan.sinks.get(sinkId)?.type === "deviceOut") {
        deviceSinks.retry(sinkId);
      }
    },
    setParam(target: EngineParamTarget, value: number) {
      if (!Number.isFinite(value)) {
        return "unavailable";
      }
      if (target.kind === "send") {
        const cable = plan.cables.get(target.edgeId);
        if (!(cable && sendAvailable(cable))) {
          return "unavailable";
        }
        sendOverlays.set(target.edgeId, clampParam(value, 0, MAX_EDGE_GAIN));
        refreshSender(cable.from);
        return "applied";
      }
      return parametersOf(target.laneId)?.set(target, value) ?? "unavailable";
    },
    /** The lane's sound, while it has one. */
    soundOf: (laneId: string) => liveInstance(laneId)?.soundId ?? null,
    /**
     * Lanes and points can start more work (a re-add after a fade, a point
     * released once a lane's cables go), so settle to empty.
     */
    async whenSettled(): Promise<void> {
      while (engine.busy()) {
        // biome-ignore lint/performance/noAwaitInLoops: a lane's work can start more, e.g. a re-add once its fade ends.
        await Promise.allSettled([
          ...[...slots.values()].map((slot) => slot.whenIdle()),
          routing.whenIdle(),
        ]);
      }
    },
  };

  return engine;
}
