/**
 * Node Playback
 *
 * Runs the node session on the managed playback engine. Every graph commit
 * in the node store is compiled, diffed against the previous plan and
 * applied as one batch of ops in a microtask:
 *
 * - a lane is a managed sound, created paused; a removed lane fades out for
 *   150 ms before its channel is released, and a lane whose stream changes
 *   in place resumes on the new one if it was playing;
 * - FX changes go through channel effects as a whole-tree replace;
 * - a Station's volume and mute, and the lane's pan and filter, are params.
 *
 * `session.channels` is written as the derived cache (`n:<nodeId>`, role
 * "node") in the same update as the graph, and master volume is the Speakers
 * gain. Lanes still reach the main bus directly, so cable ops and the lane
 * duck have no audio of their own until lane outputs land.
 *
 * Starting and stopping keeps Multiple's rules: start ownership, revisions
 * and cancellation, Play all with at most 3 starts in flight, and a fade-out
 * deactivate that releases every `n:*` channel before the orphan check. A
 * start past the playing-stream budget is refused with a message.
 */

import { fadeOut } from "@/lib/audio";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  getPlaybackChannel,
  getPlaybackSession,
  updatePlaybackSession,
} from "@/lib/collections/playback-sessions";
import {
  compile,
  type EnginePlan,
  laneChannelId,
} from "@/lib/node-graph/compile";
import {
  commitNodeGraph,
  loadNodeGraph,
  type NodeStore,
  nodeStore,
} from "@/lib/node-graph/node-store";
import { diff, type Op } from "@/lib/node-graph/reconcile";
import type { NodeGraph } from "@/lib/node-graph/schema";
import { deriveNodeChannels } from "@/lib/node-graph/session-channels";
import { buildNodeGraphFromTemplate } from "@/lib/node-graph/templates";
import { NODE_BUDGETS, type Profile } from "@/lib/node-graph/validate";
import {
  getPlaybackChannelRuntime,
  getPlaybackRuntimeChannelIds,
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { type ChannelEffects, channelEffects } from "./channel-effects.js";
import {
  clearManagedPlaybackErrors,
  getReadyManagedPlaybackSession,
  restoreManagedChannels,
  setManagedChannelPlaying,
  setManagedPlaybackError,
  setManagedSessionMasterVolume,
} from "./managed-playback-internals.js";
import {
  cleanupOrphanedSounds,
  getRuntimeSoundIds,
} from "./mode-lifecycle-cleanup.js";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "./playback-action-context.js";
import {
  type PlaybackActionError,
  reportPlaybackActionError,
} from "./playback-action-errors.js";
import {
  applySessionMasterVolume,
  cleanupManagedChannel,
  runWithConcurrency,
} from "./playback-actions-shared.js";

export type NodePlayback = {
  activate: () => Promise<void>;
  deactivate: () => Promise<void>;
  /**
   * Applies a pending commit now instead of in its microtask, so a start
   * right after an edit (a Station added from search) stays synchronous up
   * to the play call, inside the user's gesture.
   */
  flush: () => void;
  pauseAll: () => void;
  playAll: () => Promise<void>;
  setMasterVolume: (volume: number) => void;
  /** Starts or stops a Station node's lane. */
  setPlaying: (nodeId: string, playing: boolean) => Promise<void>;
  setVolume: (nodeId: string, volume: number) => void;
  toggleMasterMute: () => void;
  toggleMute: (nodeId: string) => void;
  /** Resolves once the pending commit batch and its effect and fade ops end. */
  whenSettled: () => Promise<void>;
};

export type NodePlaybackEnv = {
  profile: Profile;
  crossOriginIsolated: boolean;
};

type FadeOutSound = (
  soundId: string,
  durationMs: number,
  stopAfter: boolean
) => Promise<void>;

type GetNodePlaybackOptions = {
  ctx?: PlaybackActionContext;
  effects?: Pick<ChannelEffects, "change">;
  fadeOutDurationMs?: number;
  fadeOutSound?: FadeOutSound;
  getEnv?: () => NodePlaybackEnv;
  store?: NodeStore;
};

type PlaybackCancellation = "deactivate" | "pause" | "remove";

type PlayAllGeneration = { cancellation: PlaybackCancellation | null };

type ChannelStartOwnership = {
  cancellation: PlaybackCancellation | null;
  cancellationRevision: number | null;
  channelId: string;
  revision: number;
};

/** A start waiting for its lane to settle, before it takes ownership. */
type PendingChannelStart = { cancelled: boolean; channelId: string };

type StationData = { volume: number; muted: boolean };

const DEFAULT_FADE_OUT_DURATION_MS = 150;
const PLAY_ALL_CONCURRENCY = 3;
const NODE_CHANNEL_PREFIX = "n:";
const IOS_USER_AGENT = /iPad|iPhone|iPod/;
/** iPadOS reports a Mac user agent; touch points give it away. */
const MAC_USER_AGENT = /Macintosh/;
/** The engine's resting filter: a highpass at 0 Hz passes everything. */
const BYPASS_FILTER = {
  enabled: false,
  frequency: 0,
  gain: 0,
  Q: 1,
  type: "highpass",
} as const;
const EMPTY_PLAN: EnginePlan = {
  budget: { monitoringChannels: 0 },
  edges: new Map(),
  issues: [],
  lanes: new Map(),
  sinks: new Map(),
};
const instances = new WeakMap<PlaybackActionContext, NodePlayback>();

/** Mobile is a coarse pointer or iOS, which gets the smaller budgets. */
export function detectNodePlaybackEnv(): NodePlaybackEnv {
  if (typeof window === "undefined") {
    return { crossOriginIsolated: false, profile: "desktop" };
  }
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const { maxTouchPoints, userAgent } = window.navigator;
  const iOS =
    IOS_USER_AGENT.test(userAgent) ||
    (MAC_USER_AGENT.test(userAgent) && maxTouchPoints > 1);
  return {
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    profile: coarse || iOS ? "mobile" : "desktop",
  };
}

function isNodeChannelId(channelId: string): boolean {
  return channelId.startsWith(NODE_CHANNEL_PREFIX);
}

function warn(message: string) {
  return (error: unknown) => console.warn(`[NodePlayback] ${message}`, error);
}

function budgetError(limit: number, channelId: string): PlaybackActionError {
  const radio = getPlaybackChannel("node", channelId)?.radio ?? undefined;
  return {
    cause: null,
    channelId,
    code: "PLAY_ERROR",
    mode: "node",
    radio,
    rawMessage: null,
    userMessage: `Up to ${limit} streams can play at once here. Pause one to start this.`,
  };
}

function findStation(graph: NodeGraph | null, nodeId: string) {
  const node = graph?.nodes.find((entry) => entry.id === nodeId);
  return node?.type === "station" ? node : undefined;
}

function createNodePlayback(
  ctx: PlaybackActionContext,
  {
    effects,
    fadeOutDurationMs,
    fadeOutSound,
    getEnv,
    store,
  }: Required<Omit<GetNodePlaybackOptions, "ctx">>
): NodePlayback {
  const activeChannelStarts = new Set<ChannelStartOwnership>();
  const pendingChannelStarts = new Set<PendingChannelStart>();
  const activePlayAllGenerations = new Set<PlayAllGeneration>();
  const channelStartRevisions = new Map<string, number>();
  const unmutedVolumes = new Map<string, number>();
  let unmutedMasterVolume = 1;

  let plan = EMPTY_PLAN;
  let active = false;
  /** Bumped by activate and deactivate; stale async work checks it. */
  let epoch = 0;
  let observedGraph: NodeGraph | null = null;
  let subscription: { unsubscribe: () => void } | null = null;
  let batch: Promise<void> | null = null;
  const inFlight = new Set<Promise<unknown>>();
  /** Per lane: a removal fade, then any re-add, still in progress. */
  const settlingLanes = new Map<string, Promise<void>>();
  /** Lanes removed in this batch that were playing, for an in-place re-add. */
  const carriedLanes = new Map<string, boolean>();
  const laneGenerations = new Map<string, number>();

  const track = <T>(promise: Promise<T>): Promise<T> => {
    inFlight.add(promise);
    promise.then(
      () => inFlight.delete(promise),
      () => inFlight.delete(promise)
    );
    return promise;
  };

  const bumpLane = (laneId: string) => {
    const generation = (laneGenerations.get(laneId) ?? 0) + 1;
    laneGenerations.set(laneId, generation);
    return generation;
  };

  const advanceChannelRevision = (channelId: string) => {
    const revision = (channelStartRevisions.get(channelId) ?? 0) + 1;
    channelStartRevisions.set(channelId, revision);
    return revision;
  };

  const beginChannelStart = (channelId: string): ChannelStartOwnership => {
    const revision = advanceChannelRevision(channelId);
    const ownership = {
      cancellation: null,
      cancellationRevision: null,
      channelId,
      revision,
    };
    activeChannelStarts.add(ownership);
    return ownership;
  };

  const setChannelPlaying = async (
    channelId: string,
    playing: boolean,
    revision: number,
    shouldReportError = () => channelStartRevisions.get(channelId) === revision
  ) => {
    clearManagedPlaybackErrors([channelId]);
    const channel = getPlaybackChannel("node", channelId);
    try {
      await setManagedChannelPlaying("node", channel, playing, ctx);
      return true;
    } catch (error) {
      if (shouldReportError()) {
        const reportedError = reportPlaybackActionError(ctx.reportError, {
          cause: error,
          channelId,
          code: "PLAY_ERROR",
          mode: "node",
          radio: channel?.radio ?? undefined,
        });
        setManagedPlaybackError(
          channelId,
          reportedError,
          channel?.radio ?? undefined
        );
      }
      return false;
    }
  };

  const pauseChannel = (channelId: string) => {
    const runtime = getPlaybackChannelRuntime(channelId);
    if (runtime.soundId) {
      ctx.audio.pauseSound(runtime.soundId);
    }
    if (
      runtime.soundId ||
      runtime.isPlaying ||
      runtime.isLoading ||
      runtime.isBuffering
    ) {
      setPlaybackChannelRuntime(channelId, () => ({
        isBuffering: false,
        isLoading: false,
        isPlaying: false,
      }));
    }
  };

  const cancelChannelStarts = (
    cancellation: PlaybackCancellation,
    channelId?: string
  ) => {
    for (const pending of pendingChannelStarts) {
      if (!channelId || pending.channelId === channelId) {
        pending.cancelled = true;
      }
    }
    let cancelled = false;
    for (const ownership of activeChannelStarts) {
      if (channelId && ownership.channelId !== channelId) {
        continue;
      }
      if (
        cancellation === "pause" &&
        ownership.cancellation !== null &&
        ownership.cancellation !== "pause"
      ) {
        continue;
      }
      ownership.cancellation = cancellation;
      ownership.cancellationRevision =
        channelStartRevisions.get(ownership.channelId) ?? ownership.revision;
      cancelled = true;
    }
    return cancelled;
  };

  const getOwnedChannelIds = () =>
    Array.from(
      new Set([
        ...(getPlaybackSession("node")?.channels.map((channel) => channel.id) ??
          []),
        ...[...plan.lanes.values()].map((lane) => lane.channelId),
        ...getPlaybackRuntimeChannelIds().filter(isNodeChannelId),
      ])
    );

  /** Streams playing, loading or starting, other than `channelId`. */
  const countBusyStreams = (channelId: string) => {
    const busy = new Set(
      getPlaybackRuntimeChannelIds().filter((id) => {
        if (!isNodeChannelId(id)) {
          return false;
        }
        const runtime = getPlaybackChannelRuntime(id);
        return runtime.isPlaying || runtime.isLoading;
      })
    );
    for (const ownership of activeChannelStarts) {
      if (ownership.cancellation === null) {
        busy.add(ownership.channelId);
      }
    }
    busy.delete(channelId);
    return busy.size;
  };

  /**
   * Writes a lane's native strip onto its sound once the sound has nodes.
   * Both halves are always written, so a pan back to centre or a removed
   * filter reaches a sound that still holds the old values.
   */
  const applyLaneStrip = (channelId: string) => {
    const lane = [...plan.lanes.values()].find(
      (entry) => entry.channelId === channelId
    );
    const { soundId } = getPlaybackChannelRuntime(channelId);
    if (!(lane && soundId)) {
      return;
    }
    ctx.audio.setPan(soundId, lane.pan);
    ctx.audio.updateFilter(
      soundId,
      lane.filter ? { ...lane.filter, enabled: true, gain: 0 } : BYPASS_FILTER
    );
  };

  /**
   * Waits out a lane's removal fade or re-add. Returns false when a pause,
   * removal or deactivate arrived meanwhile, so the start must not run.
   */
  const awaitLaneSettled = async (channelId: string) => {
    const settling = settlingLanes.get(
      channelId.slice(NODE_CHANNEL_PREFIX.length)
    );
    if (!settling) {
      return true;
    }
    const pending: PendingChannelStart = { cancelled: false, channelId };
    const startEpoch = epoch;
    pendingChannelStarts.add(pending);
    try {
      await settling;
    } finally {
      pendingChannelStarts.delete(pending);
    }
    return !pending.cancelled && epoch === startEpoch;
  };

  const startChannel = async (channelId: string) => {
    // Without a settling lane this stays synchronous up to the play call,
    // inside the user's gesture.
    if (
      settlingLanes.has(channelId.slice(NODE_CHANNEL_PREFIX.length)) &&
      !(await awaitLaneSettled(channelId))
    ) {
      return;
    }
    const limit = NODE_BUDGETS[getEnv().profile].playingStreams;
    if (countBusyStreams(channelId) >= limit) {
      setManagedPlaybackError(channelId, budgetError(limit, channelId));
      return;
    }
    const ownership = beginChannelStart(channelId);
    try {
      const starting = setChannelPlaying(
        channelId,
        true,
        ownership.revision,
        () =>
          ownership.cancellation === null &&
          channelStartRevisions.get(channelId) === ownership.revision
      );
      // The play call builds the sound's nodes and requests the stream
      // synchronously; write the strip now, before any audio reaches them.
      applyLaneStrip(channelId);
      const started = await starting;
      if (started && ownership.cancellation === null) {
        // Again once it plays, for nodes the start built later.
        applyLaneStrip(channelId);
      }
    } finally {
      activeChannelStarts.delete(ownership);
      if (
        ownership.cancellation !== null &&
        channelStartRevisions.get(channelId) === ownership.cancellationRevision
      ) {
        if (ownership.cancellation === "pause") {
          pauseChannel(channelId);
        } else {
          cleanupManagedChannel(channelId, ctx);
          resetPlaybackChannelRuntime(channelId);
        }
      }
    }
  };

  const reportLaneError = (channelId: string, error: unknown) => {
    const radio = getPlaybackChannel("node", channelId)?.radio ?? undefined;
    setManagedPlaybackError(
      channelId,
      reportPlaybackActionError(ctx.reportError, {
        cause: error,
        channelId,
        code: "PLAY_ERROR",
        mode: "node",
        radio,
      }),
      radio
    );
  };

  const resumeLane = (channelId: string) => {
    track(startChannel(channelId)).catch(warn("Could not resume Station"));
  };

  /** Creates the lane's sound paused, as restore does for Multiple. */
  const createLaneSound = (channelId: string) => {
    // A start still settling for the old sound must not clean this one.
    advanceChannelRevision(channelId);
    const channel = getPlaybackChannel("node", channelId);
    if (channel) {
      restoreManagedChannels("node", [channel], ctx);
    }
  };

  const addLane = (laneId: string, channelId: string) => {
    const generation = bumpLane(laneId);
    const wasPlaying = carriedLanes.get(laneId) ?? false;
    carriedLanes.delete(laneId);
    const settling = settlingLanes.get(laneId);
    if (!settling) {
      createLaneSound(channelId);
      if (wasPlaying) {
        resumeLane(channelId);
      }
      return;
    }
    // The same lane is still fading out its old stream; take over after it.
    const startEpoch = epoch;
    const ready = settling.then(() => {
      if (epoch !== startEpoch || laneGenerations.get(laneId) !== generation) {
        return;
      }
      try {
        createLaneSound(channelId);
      } catch (error) {
        reportLaneError(channelId, error);
      }
    });
    settlingLanes.set(laneId, ready);
    track(ready).finally(() => {
      if (settlingLanes.get(laneId) === ready) {
        settlingLanes.delete(laneId);
      }
    });
    // Queued behind `ready` now, so a pause during the fade still wins.
    if (wasPlaying) {
      resumeLane(channelId);
    }
  };

  /** Fades a removed lane's sound out, then releases its channel. */
  const releaseLane = async (channelId: string, startEpoch: number) => {
    const { soundId } = getPlaybackChannelRuntime(channelId);
    if (soundId) {
      try {
        await fadeOutSound(soundId, fadeOutDurationMs, true);
      } catch (error) {
        warn("Could not fade out a removed lane")(error);
      }
    }
    // Deactivate releases everything itself; don't touch a new epoch.
    if (epoch === startEpoch) {
      cleanupManagedChannel(channelId, ctx);
      resetPlaybackChannelRuntime(channelId);
    }
  };

  const removeLane = (laneId: string, channelId: string) => {
    bumpLane(laneId);
    const runtime = getPlaybackChannelRuntime(channelId);
    carriedLanes.set(laneId, runtime.isPlaying || runtime.isLoading);
    cancelChannelStarts("remove", channelId);
    const startEpoch = epoch;
    const removal = (settlingLanes.get(laneId) ?? Promise.resolve()).then(() =>
      releaseLane(channelId, startEpoch)
    );
    settlingLanes.set(laneId, removal);
    track(removal).finally(() => {
      if (settlingLanes.get(laneId) === removal) {
        settlingLanes.delete(laneId);
      }
    });
  };

  const changeLaneEffects = (channelId: string, tree: EffectConfig[]) => {
    track(
      effects.change(
        { channelId, sessionId: "node" },
        { tree, type: "replace" }
      )
    ).catch(warn("Could not apply lane effects"));
  };

  const applyParam = (
    op: Extract<Op, { type: "setParam" }>,
    next: EnginePlan
  ) => {
    if (op.target === "edge") {
      // Cables carry no audio of their own until lane outputs land.
      return;
    }
    const lane = next.lanes.get(op.id);
    if (!lane) {
      return;
    }
    const { channelId } = lane;
    switch (op.param) {
      case "volume":
        // A muted sound's gain is its mute; the cache already holds the value.
        if (!lane.muted) {
          ctx.channels.setVolume("node", channelId, op.value);
        }
        break;
      case "muted":
        ctx.channels.setMuted("node", channelId, op.value);
        if (!op.value) {
          // The engine restores its own pre-mute gain, which is unset for a
          // sound created muted; re-apply the Station volume.
          ctx.channels.setVolume("node", channelId, lane.volume);
        }
        break;
      case "pan":
      case "filter":
        if (getPlaybackChannelRuntime(channelId).isPlaying) {
          applyLaneStrip(channelId);
        }
        break;
      default: {
        const exhaustive: never = op;
        return exhaustive;
      }
    }
  };

  const applyOp = (op: Op, next: EnginePlan) => {
    switch (op.type) {
      case "addLane":
        addLane(op.lane.id, op.lane.channelId);
        break;
      case "removeLane":
        removeLane(op.laneId, laneChannelId(op.laneId));
        break;
      case "setLaneEffects":
      case "replaceLaneEffects":
        changeLaneEffects(laneChannelId(op.laneId), op.effects);
        break;
      case "setParam":
        applyParam(op, next);
        break;
      // Lanes reach the main bus directly until lane outputs land, so the
      // layout duck and cable ops have nothing to act on yet.
      case "duckLane":
      case "unduckLane":
      case "addEdge":
      case "removeEdge":
      case "rewireEdge":
        break;
      default: {
        const exhaustive: never = op;
        return exhaustive;
      }
    }
  };

  /**
   * `strict` rethrows the first op failure; otherwise a failing lane is
   * marked and the rest run.
   */
  const applyOps = (ops: readonly Op[], next: EnginePlan, strict: boolean) => {
    for (const op of ops) {
      if (strict) {
        applyOp(op, next);
        continue;
      }
      try {
        applyOp(op, next);
      } catch (error) {
        if (op.type === "addLane") {
          reportLaneError(op.lane.channelId, error);
        } else {
          warn(`Could not apply ${op.type}`)(error);
        }
      }
    }
  };

  /**
   * Compiles the current graph, writes it with its derived channels in one
   * session update, then applies the diff. `strict` (activate) rethrows the
   * first op failure.
   */
  const reconcile = (strict: boolean) => {
    const { graph } = store.state;
    observedGraph = graph;
    if (!graph) {
      return;
    }
    const next = compile(graph, getEnv());
    const previousChannels = getPlaybackSession("node")?.channels ?? [];
    updatePlaybackSession("node", (draft) => {
      draft.graph = graph;
      draft.channels = deriveNodeChannels(next, previousChannels);
    });
    // Undo and template loads change volumes too; mute restores the latest.
    for (const [laneId, lane] of next.lanes) {
      if (lane.volume > 0) {
        unmutedVolumes.set(laneId, lane.volume);
      }
    }
    const ops = diff(plan, next);
    plan = next;
    try {
      applyOps(ops, next, strict);
    } finally {
      // A carry is only "in place" within one batch; a later re-add of the
      // same Station must not resume it.
      carriedLanes.clear();
    }
  };

  /** Reconciles a commit not yet applied; a no-op once it has been. */
  const applyPendingCommit = () => {
    if (!active || store.state.graph === observedGraph) {
      return;
    }
    try {
      reconcile(false);
    } catch (error) {
      warn("Could not apply a patch change")(error);
    }
  };

  const onStoreChange = () => {
    if (!active || batch || store.state.graph === observedGraph) {
      return;
    }
    batch = new Promise<void>((resolve) => {
      queueMicrotask(() => {
        batch = null;
        applyPendingCommit();
        resolve();
      });
    });
  };

  /** Ops can start more work (a re-add after a fade), so settle to empty. */
  const whenSettled = async (): Promise<void> => {
    await batch;
    if (inFlight.size === 0) {
      return;
    }
    await Promise.allSettled([...inFlight]);
    return whenSettled();
  };

  const stopListening = () => {
    active = false;
    subscription?.unsubscribe();
    subscription = null;
  };

  const updateStation = (
    nodeId: string,
    update: (data: StationData) => Partial<StationData>
  ) => {
    commitNodeGraph(
      (graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === nodeId && node.type === "station"
            ? { ...node, data: { ...node.data, ...update(node.data) } }
            : node
        ),
      }),
      store
    );
  };

  const setVolume = (nodeId: string, volume: number) => {
    if (volume > 0) {
      unmutedVolumes.set(nodeId, volume);
    }
    updateStation(nodeId, ({ muted }) => ({
      muted: volume > 0 ? false : muted,
      volume,
    }));
  };

  const setMasterVolume = (volume: number) => {
    if (volume > 0) {
      unmutedMasterVolume = volume;
    }
    setManagedSessionMasterVolume("node", volume, ctx);
  };

  const setPlaying = async (nodeId: string, playing: boolean) => {
    const channelId = laneChannelId(nodeId);
    if (playing) {
      await startChannel(channelId);
      return;
    }
    const cancelledStart = cancelChannelStarts("pause", channelId);
    const revision = cancelledStart
      ? (channelStartRevisions.get(channelId) ??
        advanceChannelRevision(channelId))
      : advanceChannelRevision(channelId);
    await setChannelPlaying(channelId, false, revision);
  };

  return {
    async activate() {
      const session = await getReadyManagedPlaybackSession("node");
      epoch += 1;
      plan = EMPTY_PLAN;
      settlingLanes.clear();
      carriedLanes.clear();
      stopListening();
      loadNodeGraph(
        session.graph ?? buildNodeGraphFromTemplate("blank"),
        store
      );
      observedGraph = store.state.graph;
      active = true;
      subscription = store.subscribe(onStoreChange);
      try {
        reconcile(true);
      } catch (error) {
        stopListening();
        throw error;
      }
      applySessionMasterVolume("node", ctx);
      if (session.masterVolume > 0) {
        unmutedMasterVolume = session.masterVolume;
      }
      for (const node of store.state.graph?.nodes ?? []) {
        if (node.type === "station" && node.data.volume > 0) {
          unmutedVolumes.set(node.id, node.data.volume);
        }
      }
    },
    async deactivate() {
      // A commit still queued in this tick's batch would be dropped once
      // listening stops; persist it so the next activation loads it.
      const pendingGraph = store.state.graph;
      if (active && pendingGraph && pendingGraph !== observedGraph) {
        const previousChannels = getPlaybackSession("node")?.channels ?? [];
        updatePlaybackSession("node", (draft) => {
          draft.graph = pendingGraph;
          draft.channels = deriveNodeChannels(
            compile(pendingGraph, getEnv()),
            previousChannels
          );
        });
      }
      stopListening();
      epoch += 1;
      settlingLanes.clear();
      carriedLanes.clear();
      for (const generation of activePlayAllGenerations) {
        generation.cancellation = "deactivate";
      }
      cancelChannelStarts("deactivate");
      const initialChannelIds = getOwnedChannelIds();
      const initialSoundIds = getRuntimeSoundIds(initialChannelIds);
      await Promise.all(
        initialSoundIds.map((soundId) =>
          fadeOutSound(soundId, fadeOutDurationMs, true)
        )
      );
      for (const generation of activePlayAllGenerations) {
        generation.cancellation = "deactivate";
      }
      cancelChannelStarts("deactivate");
      const channelIds = Array.from(
        new Set([...initialChannelIds, ...getOwnedChannelIds()])
      );
      const soundIds = Array.from(
        new Set([...initialSoundIds, ...getRuntimeSoundIds(channelIds)])
      );
      for (const channelId of channelIds) {
        cleanupManagedChannel(channelId, ctx);
        resetPlaybackChannelRuntime(channelId);
      }
      plan = EMPTY_PLAN;
      observedGraph = null;
      cleanupOrphanedSounds(soundIds, ctx, "node");
    },
    flush: applyPendingCommit,
    pauseAll() {
      for (const generation of activePlayAllGenerations) {
        if (generation.cancellation === null) {
          generation.cancellation = "pause";
        }
      }
      cancelChannelStarts("pause");
      for (const channel of getPlaybackSession("node")?.channels ?? []) {
        pauseChannel(channel.id);
      }
    },
    async playAll() {
      const generation: PlayAllGeneration = { cancellation: null };
      activePlayAllGenerations.add(generation);
      const channels = (getPlaybackSession("node")?.channels ?? []).filter(
        (channel) => !getPlaybackChannelRuntime(channel.id).isPlaying
      );
      try {
        await runWithConcurrency(
          channels,
          PLAY_ALL_CONCURRENCY,
          async (channel) => {
            await startChannel(channel.id);
          },
          () => generation.cancellation === null
        );
      } finally {
        activePlayAllGenerations.delete(generation);
      }
    },
    setMasterVolume,
    setPlaying,
    setVolume,
    toggleMasterMute() {
      const volume = getPlaybackSession("node")?.masterVolume ?? 1;
      if (volume > 0) {
        unmutedMasterVolume = volume;
        setMasterVolume(0);
        return;
      }
      setMasterVolume(unmutedMasterVolume);
    },
    toggleMute(nodeId) {
      const station = findStation(store.state.graph, nodeId);
      if (!station) {
        return;
      }
      const { muted, volume } = station.data;
      if (volume === 0) {
        setVolume(nodeId, unmutedVolumes.get(nodeId) ?? 1);
        return;
      }
      updateStation(nodeId, () => ({ muted: !muted }));
    },
    whenSettled,
  };
}

export function getNodePlayback({
  ctx = getDefaultPlaybackActionContext(),
  effects = channelEffects,
  fadeOutDurationMs = DEFAULT_FADE_OUT_DURATION_MS,
  fadeOutSound = fadeOut,
  getEnv = detectNodePlaybackEnv,
  store = nodeStore,
}: GetNodePlaybackOptions = {}): NodePlayback {
  const existing = instances.get(ctx);
  if (existing) {
    return existing;
  }
  const playback = createNodePlayback(ctx, {
    effects,
    fadeOutDurationMs,
    fadeOutSound,
    getEnv,
    store,
  });
  instances.set(ctx, playback);
  return playback;
}
