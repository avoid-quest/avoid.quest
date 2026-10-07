/**
 * Node Engine
 *
 * Plays one activation of a Node patch. Each compiled plan is diffed
 * against the last and applied to one `LaneSlot` per lane (lane.ts), which
 * owns that lane's sound from its restore to its release. The engine owns
 * what lanes share: the lane outputs and Output device sinks their sends
 * reach, the headphone cue output, the FX badges, the stream budget and
 * Play all. `dispose` refuses new starts, retires every lane and waits for
 * each to release before it closes the rest; the next activation builds a
 * new engine.
 *
 * Each lane reaches its outputs through its own `laneOut` gain
 * (node-lane-outputs), registered as the sound's output connector before it
 * first plays, which fans out into one send per output. Cable gain and mute
 * ramp each send to the sum of the lane's unmuted cables into that output.
 * Speakers sends go to the main bus; an Output device's go to its device
 * sink (node-device-sinks), or to the main bus while that sink can't play.
 * A lane ducks laneOut around its own FX layout swaps.
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
  LaneSinkRoute,
  NodeLaneOutputs,
  NodeLaneOutputsOptions,
} from "@/lib/audio/routing/node-lane-outputs";
import { findSidechainChannelId } from "@/lib/channel-effects";
import {
  type EnginePlan,
  type LaneBackend,
  laneChannelId,
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
  type StartResult,
} from "./lane.js";
import type { EngineParamTarget } from "./param-target.js";

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
   * The headphone cue bus a Track's or File's cue listen taps into. Its
   * settings are applied as a tap goes on, as a DJ deck's CUE does, since
   * Node mode alone never builds the cue output.
   */
  cueOutput: () => Pick<
    OutputRouting,
    "applySettings" | "registerCueDeck" | "releaseCue"
  >;
  deviceSinks: (options: NodeDeviceSinksOptions) => NodeDeviceSinks;
  laneOutputs: (options: NodeLaneOutputsOptions) => NodeLaneOutputs;
  /** Where each lane's sound reconciles its effects; AudioManager's. */
  effects: Pick<
    AudioManager,
    "reconcileEffects" | "setEffectFields" | "subscribeEffectsRuntimeOutcome"
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
  budget: { monitoringChannels: 0 },
  edges: new Map(),
  issues: [],
  lanes: new Map(),
  sinks: new Map(),
};

function warn(message: string) {
  return (error: unknown) => console.warn(`[NodePlayback] ${message}`, error);
}

export function createNodeEngine(options: NodeEngineOptions) {
  const { ctx } = options;
  const slots = new Map<string, LaneSlot>();
  /** A send belongs to its edge until that edge leaves the plan. */
  const transientSends = new Map<string, number>();
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

  /**
   * A lane's level per output: the gains of its unmuted cables into it,
   * summed. A muted Output device takes nothing.
   */
  const laneLevels = (laneId: string) => {
    const levels = new Map<string, number>();
    const parameters = liveInstance(laneId)?.parameters;
    for (const edge of plan.edges.values()) {
      if (edge.from.id !== laneId) {
        continue;
      }
      const sinkId = edge.to.id;
      const silenced = edge.muted || plan.sinks.get(sinkId)?.muted === true;
      const gain = parameters?.available({ edgeId: edge.id, kind: "send" })
        ? (transientSends.get(edge.id) ?? edge.gain)
        : edge.gain;
      levels.set(sinkId, (levels.get(sinkId) ?? 0) + (silenced ? 0 : gain));
    }
    return levels;
  };

  /**
   * Speakers are the main bus. An Output device plays on its sink, or on
   * the main bus while that sink can't; with no device picked, nowhere.
   */
  const routeSink: LaneSinkRoute = (sinkId, send, connectMain) => {
    const sink = plan.sinks.get(sinkId);
    if (sink?.type === "speakers") {
      return connectMain();
    }
    if (sink?.type !== "deviceOut") {
      return () => undefined;
    }
    const routed = deviceSinks.connect(sinkId, send);
    switch (routed.to) {
      case "device":
        return routed.release;
      case "speakers":
        return connectMain();
      default:
        return () => undefined;
    }
  };

  const laneOutputs = options.laneOutputs({
    getHost: () => ctx.audio,
    getLevels: laneLevels,
    // A new sound's nodes exist from its connect, before its playback starts.
    onConnect: (laneId) => slots.get(laneId)?.current?.applyStrip(),
    route: routeSink,
  });

  const deviceSinks = options.deviceSinks({
    isActive: () => !disposing,
    onReroute: (sinkId) => laneOutputs.reroute(sinkId),
    onStatus: () => options.sinkStatuses.setState(() => deviceSinks.statuses()),
  });

  /** Writes every lane's badge, and its FX nodes', when one changed. */
  const publishBadges = () => {
    const badges: Record<string, BackendBadge> = {};
    for (const lane of plan.lanes.values()) {
      const badge = laneBackendBadge(
        lane.backend,
        liveInstance(lane.id)?.outcome
      );
      if (!badge) {
        continue;
      }
      badges[lane.id] = badge;
      for (const id of enabledEffectIds(lane.effects)) {
        badges[id] = badge;
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
      const output = options.cueOutput();
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
    /**
     * A lane's effects as its plan has them, keyed from its key lane's
     * sound once that lane has one. Node has no dry/wet or tempo control.
     */
    reconcileEffects: (soundId, lane) => {
      const keyLane = findSidechainChannelId(lane.effects)?.slice(
        NODE_CHANNEL_PREFIX.length
      );
      return options.effects.reconcileEffects(soundId, {
        dryWet: 1,
        sidechainSoundId: keyLane
          ? (slots.get(keyLane)?.current?.soundId ?? null)
          : null,
        tempo: DEFAULT_EFFECT_TEMPO,
        tree: normalizeEffectTree(lane.effects),
      });
    },
    resolveStream: options.resolveStream,
    setEffectFields: (...args) => options.effects.setEffectFields(...args),
    /** A lane's sound came or went: every other lane keyed from it rebinds. */
    soundChanged: (laneId) => {
      const channelId = laneChannelId(laneId);
      for (const slot of slots.values()) {
        if (
          slot.laneId !== laneId &&
          slot.plan &&
          findSidechainChannelId(slot.plan.effects) === channelId
        ) {
          slot.effectsChanged();
        }
      }
    },
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
   * Matches the device sinks to the plan's Output devices. A removed output
   * takes its sends with it; a mute on one changes every lane's levels.
   */
  const syncSinks = (previous: EnginePlan, next: EnginePlan) => {
    const devices = new Map<string, string | null>();
    for (const sink of next.sinks.values()) {
      if (sink.type === "deviceOut") {
        devices.set(sink.id, sink.deviceId ?? null);
      }
    }
    deviceSinks.sync(devices);
    let levelsChanged = false;
    for (const [id, sink] of previous.sinks) {
      const kept = next.sinks.get(id);
      if (!kept) {
        laneOutputs.dropSink(id);
      } else if (kept.muted !== sink.muted) {
        levelsChanged = true;
      }
    }
    if (levelsChanged) {
      for (const laneId of next.lanes.keys()) {
        laneOutputs.refresh(laneId);
      }
    }
  };

  const applyParam = (
    op: Extract<Op, { type: "setParam" }>,
    refreshLane: (laneId: string | undefined) => void
  ) => {
    if (op.target === "edge") {
      refreshLane(plan.edges.get(op.id)?.from.id);
      return;
    }
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

  const applyOp = (
    op: Op,
    previous: EnginePlan,
    refreshLane: (laneId: string | undefined) => void
  ) => {
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
        applyParam(op, refreshLane);
        break;
      case "addEdge":
        refreshLane(op.edge.from.id);
        break;
      case "removeEdge":
        refreshLane(previous.edges.get(op.edgeId)?.from.id);
        break;
      case "rewireEdge":
        refreshLane(op.previous.from.id);
        refreshLane(op.edge.from.id);
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
      transientSends.forEach((_value, edgeId) => {
        if (!next.edges.has(edgeId)) {
          transientSends.delete(edgeId);
        }
      });
      const removed = new Set(
        ops.flatMap((op) => (op.type === "removeLane" ? [op.laneId] : []))
      );
      /**
       * A removed or replaced lane keeps its old stream's level through its
       * fade-out; the new stream's laneOut reads its level as it connects.
       */
      const refreshLane = (laneId: string | undefined) => {
        if (
          laneId &&
          next.lanes.has(laneId) &&
          !removed.has(laneId) &&
          !slots.get(laneId)?.current?.retiring
        ) {
          laneOutputs.refresh(laneId);
        }
      };
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
        syncSinks(previous, next);
        for (const op of ops) {
          try {
            applyOp(op, previous, refreshLane);
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
    busy: (): boolean => [...slots.values()].some((slot) => slot.busy()),
    clearTransient(target?: EngineParamTarget) {
      if (target) {
        if (target.kind === "send") {
          transientSends.delete(target.edgeId);
          const laneId = plan.edges.get(target.edgeId)?.from.id;
          if (laneId && liveInstance(laneId)) {
            laneOutputs.refresh(laneId);
          }
        } else {
          liveInstance(target.laneId)?.parameters.clear(target);
        }
      } else {
        transientSends.clear();
        for (const slot of slots.values()) {
          if (!slot.current?.retiring) {
            slot.current?.parameters.clear();
            laneOutputs.refresh(slot.laneId);
          }
        }
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
          options.cueOutput().releaseCue();
        } catch (error) {
          warn("Could not close the cue output")(error);
        }
      }
      laneOutputs.dispose();
      deviceSinks.dispose();
      options.sinkStatuses.setState(() => deviceSinks.statuses());
      plan = EMPTY_PLAN;
      transientSends.clear();
      publishBadges();
      cleanupOrphanedSounds([...soundIds], ctx, "node");
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
      if (target.kind === "send") {
        const laneId = plan.edges.get(target.edgeId)?.from.id;
        const instance = laneId ? liveInstance(laneId) : undefined;
        if (
          !(
            laneId &&
            instance?.parameters.available(target) &&
            Number.isFinite(value)
          )
        ) {
          return "unavailable";
        }
        transientSends.set(
          target.edgeId,
          Math.max(0, Math.min(MAX_EDGE_GAIN, value))
        );
        laneOutputs.refresh(laneId);
        return "applied";
      }
      return (
        liveInstance(target.laneId)?.parameters.set(target, value) ??
        "unavailable"
      );
    },
    /** The lane's sound, while it has one. */
    soundOf: (laneId: string) => liveInstance(laneId)?.soundId ?? null,
    /** Lanes can start more work (a re-add after a fade), so settle to empty. */
    async whenSettled(): Promise<void> {
      while (engine.busy()) {
        // biome-ignore lint/performance/noAwaitInLoops: a lane's work can start more, e.g. a re-add once its fade ends.
        await Promise.allSettled(
          [...slots.values()].map((slot) => slot.whenIdle())
        );
      }
    },
  };

  return engine;
}
