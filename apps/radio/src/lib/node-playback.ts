/**
 * Node Playback
 *
 * Runs the node session on the managed playback engine. Every graph commit
 * in the node store is compiled, stored and applied to the activation's
 * engine (node-engine/engine) as one batch in a microtask. The engine gives
 * each lane one owner (node-engine/lane), which makes its sound, starts,
 * pauses and renews it, reconciles its effects from its plan, and fades it
 * out for 150 ms before releasing it; the saved session is never read for
 * a lane.
 *
 * `session.channels` is written as the derived cache (`n:<nodeId>`, role
 * "node") in the same update as the graph, and master volume is the Speakers
 * gain. A Station's volume and mute go through the channel facade; the
 * source's fader stays the volume controller's.
 *
 * An Audio input's lane is a live capture started through the device-input
 * start DJ decks use. Restore never opens a mic: its sound is only made
 * when the user goes live, and a loaded patch has every Monitor off.
 *
 * Each source's channel strip compiles into the plan (trim and solo on its
 * cables, pan on the lane). A Track's or File's transport goes through the
 * strip calls DJ decks share (source-strip): speed and key lock once its
 * sound plays and on each change, seek and cue as media-element seeks,
 * loop as the whole-track repeat at the end, and cue listen as a pre-fader
 * tap on the headphone cue bus.
 *
 * Each lane with FX publishes a backend badge for its FX nodes: `compat`
 * from the compile estimate until the effects controller reports, then from
 * the controller's outcome, so a dry fallback reads `bypassed`.
 *
 * Every tab writes its whole patch, so another tab's edit is taken in as
 * it arrives through storage, or this tab's next edit would write over it.
 * A changed patch loads like an activation's: no undo step, a fresh
 * history, each tab's own Monitors kept, and nothing written back. An edit
 * this tab writes while that patch loads wins instead, and a toast says the
 * other tab's change was replaced.
 */

import { deepEquals } from "@tanstack/react-db";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { fadeOut } from "@/lib/audio";
import { createNodeDeviceSinks } from "@/lib/audio/routing/node-device-sinks";
import { createNodeLaneOutputs } from "@/lib/audio/routing/node-lane-outputs";
import { createNodeSessionPersistence } from "@/lib/collections/node-session-persistence";
import {
  getNodeSessionReadOnlyVersion,
  getPlaybackSession,
  hydrateNodeGraphNamModels,
  type PlaybackSessionRecord,
  subscribeToOtherTabSessionWrites,
  takeOtherTabNodeGraph,
  updatePlaybackSession,
} from "@/lib/collections/playback-sessions";
import { resolveDjPlatformStreamUrl } from "@/lib/dj-platform-stream-port";
import { type EnginePlan, laneChannelId } from "@/lib/node-graph/compile";
import { compiledPlan } from "@/lib/node-graph/compiled-plan";
import {
  setSourceRadio,
  setSourceStrip,
  withMonitorsOff,
} from "@/lib/node-graph/graph-edits";
import {
  adoptNodeGraph,
  commitNodeGraph,
  loadNodeGraphMigration,
  type NodeStore,
  nodeStore,
} from "@/lib/node-graph/node-store";
import {
  type GraphNode,
  isRadioSourceNode,
  migrateNodeGraph,
  type NodeGraph,
} from "@/lib/node-graph/schema";
import { deriveNodeChannels } from "@/lib/node-graph/session-channels";
import { buildNodeGraphFromTemplate } from "@/lib/node-graph/templates";
import { NODE_BUDGETS, type Profile } from "@/lib/node-graph/validate";
import { getOutputRouting } from "@/lib/output-routing.js";
import { seekSound } from "@/lib/source-strip";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";
import {
  clearManagedPlaybackErrors,
  getReadyManagedPlaybackSession,
  setManagedSessionMasterVolume,
} from "./managed-playback-internals.js";
import {
  createNodeEngine,
  type NodeEngine,
  type NodeEngineOptions,
  nodeBackendBadges,
  nodeSinkStatuses,
} from "./node-engine/engine.js";
import { reportNodeFailure } from "./node-engine/lane.js";
import {
  getDefaultPlaybackActionContext,
  type PlaybackActionContext,
} from "./playback-action-context.js";
import { applySessionMasterVolume } from "./playback-actions-shared.js";

export {
  type BackendBadge,
  laneBackendBadge,
  type NodeBackendBadgeStore,
  type NodeBackendBadges,
  type NodeSinkStatuses,
  nodeBackendBadges,
  nodeSinkStatuses,
} from "./node-engine/engine.js";

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
  /**
   * Plays every Station, Track and File; an Audio input goes live only
   * from its own Go live.
   */
  playAll: () => Promise<void>;
  retryOutputDevice: (nodeId: string) => void;
  setMasterVolume: (volume: number) => void;
  /** Starts or stops a source's lane: a Station plays, an Audio input goes live. */
  setPlaying: (nodeId: string, playing: boolean) => Promise<void>;
  setVolume: (nodeId: string, volume: number) => void;
  /** Moves a Track or File to one of its album's or playlist's tracks and plays it. */
  playTrack: (nodeId: string, streamUrl: string) => Promise<void>;
  /** Seeks a Track or File, in seconds; live radio and inputs ignore it. */
  seek: (nodeId: string, position: number) => void;
  /** Stores where a Track or File is now as its cue point. */
  setCue: (nodeId: string) => void;
  /** Seeks a Track or File to its cue point, once one is set. */
  jumpToCue: (nodeId: string) => void;
  toggleMasterMute: () => void;
  toggleMute: (nodeId: string) => void;
  /** Resolves once the pending commit batch and every lane's work end. */
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

export type GetNodePlaybackOptions = Partial<
  Omit<NodeEngineOptions, "commitTrack" | "fadeOut" | "streamLimit">
> & {
  fadeOutDurationMs?: number;
  fadeOutSound?: FadeOutSound;
  getEnv?: () => NodePlaybackEnv;
  /** Calls back after another tab writes the sessions; returns a stop. */
  otherTabWrites?: (listener: () => void) => () => void;
  store?: NodeStore;
};

/** A source's own level: a Station's, Track's, File's or Audio input's. */
type SourceData = { volume: number; muted: boolean };

const DEFAULT_FADE_OUT_DURATION_MS = 150;
const IOS_USER_AGENT = /iPad|iPhone|iPod/;
/** iPadOS reports a Mac user agent; touch points give it away. */
const MAC_USER_AGENT = /Macintosh/;
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

/** Whether two values store as the same JSON, in any key order. */
function isSameStored(a: unknown, b: unknown): boolean {
  return (
    a === b ||
    deepEquals(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)))
  );
}

/** Whether two stored patches match. Monitor is each tab's own Go live. */
function isSamePatch(a: NodeGraph, b: NodeGraph): boolean {
  return a === b || isSameStored(withMonitorsOff(a), withMonitorsOff(b));
}

/** `graph` with each Audio input's Monitor as in `local`, else off. */
function withMonitorsFrom(graph: NodeGraph, local: NodeGraph): NodeGraph {
  const monitors = new Map(
    local.nodes.flatMap((node) =>
      node.type === "deviceIn" ? [[node.id, node.data.strip.monitor]] : []
    )
  );
  let changed = false;
  const nodes = graph.nodes.map((node): GraphNode => {
    const monitor = monitors.get(node.id) ?? false;
    if (node.type !== "deviceIn" || node.data.strip.monitor === monitor) {
      return node;
    }
    changed = true;
    return {
      ...node,
      data: { ...node.data, strip: { ...node.data.strip, monitor } },
    };
  });
  return changed ? { ...graph, nodes } : graph;
}

function reportPatchConflict(): void {
  console.warn(
    "[NodePlayback] The patch changed in another tab during an edit here; this tab's edit was kept"
  );
  toast.warning(
    "This patch also changed in another tab. The edit made here replaced that change.",
    { id: "node-patch-conflict" }
  );
}

/**
 * A node whose data holds a source level: a Station, Track, File or Audio
 * input.
 */
function findSource(graph: NodeGraph | null, nodeId: string) {
  const node = graph?.nodes.find((entry) => entry.id === nodeId);
  return isRadioSourceNode(node) || node?.type === "deviceIn"
    ? node
    : undefined;
}

function createNodePlayback(
  ctx: PlaybackActionContext,
  options: Required<Omit<GetNodePlaybackOptions, "ctx">>
): NodePlayback {
  const { getEnv, otherTabWrites, store } = options;
  const unmutedVolumes = new Map<string, number>();
  let unmutedMasterVolume = 1;
  /** This activation's engine; none while Node is inactive. */
  let engine: NodeEngine | null = null;
  /** The last engine's deactivation, until its lanes are released. */
  let disposal: Promise<void> | null = null;
  let active = false;
  const isReadOnly = () =>
    store.state.readOnlyVersion !== null ||
    getNodeSessionReadOnlyVersion() !== null;
  let observedGraph: NodeGraph | null = null;
  let subscription: { unsubscribe: () => void } | null = null;
  /** The stored patch as this tab last wrote, loaded or took it in. */
  let seenStoredGraph: NodeGraph | null = null;
  /** Another tab's patch, taken in: its reconcile writes nothing back. */
  let adoptedGraph: NodeGraph | null = null;
  let otherTabGeneration = 0;
  let stopOtherTabWrites: (() => void) | null = null;
  let batch: Promise<void> | null = null;

  const lanePlan = (nodeId: string) => engine?.plan.lanes.get(nodeId);

  /**
   * Moves a Track or File lane to another of its tracks, as one commit that
   * folds into the next undo step, while its source still holds `from`.
   */
  const commitTrack = (nodeId: string, from: Radio, radio: Radio) => {
    const source = findSource(store.state.graph, nodeId);
    if (
      !(
        active &&
        isRadioSourceNode(source) &&
        source.data.radio === from &&
        commitNodeGraph((graph) => setSourceRadio(graph, nodeId, radio), store)
      )
    ) {
      return false;
    }
    applyPendingCommit();
    return true;
  };

  const createEngine = () =>
    createNodeEngine({
      ...options,
      commitTrack,
      ctx,
      fadeOut: (soundId) =>
        options.fadeOutSound(soundId, options.fadeOutDurationMs, true),
      streamLimit: () => NODE_BUDGETS[getEnv().profile].playingStreams,
    });

  /** Retires every lane, then the engine's outputs, before the orphan check. */
  const disposeEngine = async () => {
    const retired = engine;
    engine = null;
    if (retired) {
      disposal = retired.dispose();
    }
    try {
      await disposal;
    } finally {
      disposal = null;
    }
  };

  const persistence = createNodeSessionPersistence(
    reportNodeFailure("Could not save a patch change")
  );

  /** Writes `graph` with its derived channels in one session update. */
  const storePatch = (graph: NodeGraph, next: EnginePlan) => {
    const previousChannels = getPlaybackSession("node")?.channels ?? [];
    const channels = deriveNodeChannels(next, previousChannels);
    if (graph !== adoptedGraph) {
      const write = (draft: PlaybackSessionRecord) => {
        draft.graph = graph;
        draft.channels = channels;
      };
      if (store.state.history.present === graph) {
        persistence.flush();
        updatePlaybackSession("node", write);
      } else {
        persistence.update(write);
      }
    } else if (isSameStored(channels, previousChannels)) {
      // Another tab's patch is stored, with these channels: writing it back
      // would only echo it to that tab.
      return;
    } else {
      persistence.flush();
      updatePlaybackSession("node", (draft) => {
        draft.channels = channels;
      });
    }
    seenStoredGraph = getPlaybackSession("node")?.graph ?? null;
  };

  /**
   * Compiles the current graph, writes it with its derived channels in one
   * session update, then applies it to the engine. `strict` (activation)
   * rethrows the first lane that could not be made.
   */
  const reconcile = (strict: boolean) => {
    const { graph } = store.state;
    observedGraph = graph;
    if (!(graph && engine) || isReadOnly()) {
      return;
    }
    const next = compiledPlan(graph, getEnv());
    storePatch(graph, next);
    // Undo and template loads change volumes too; mute restores the latest.
    for (const [laneId, lane] of next.lanes) {
      if (lane.volume > 0) {
        unmutedVolumes.set(laneId, lane.volume);
      }
    }
    engine.apply(next, strict);
  };

  /** Reconciles a commit not yet applied; a no-op once it has been. */
  const applyPendingCommit = () => {
    if (!active || store.state.graph === observedGraph) {
      return;
    }
    try {
      reconcile(false);
    } catch (error) {
      reportNodeFailure("Could not apply a patch change")(error);
    }
  };

  const onStoreChange = () => {
    if (!active || batch) {
      return;
    }
    if (store.state.graph === observedGraph) {
      if (store.state.history.present === observedGraph) {
        persistence.flush();
      }
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

  /** Lanes can commit again (a track change), so settle to empty, writes last. */
  const whenSettled = async (): Promise<void> => {
    await batch;
    await disposal;
    await engine?.whenSettled();
    await persistence.whenSettled();
    if (batch || engine?.busy()) {
      return whenSettled();
    }
  };

  /**
   * Takes another tab's newer patch in, unless this tab has an edit it
   * hasn't written yet or wrote one since: that edit is kept, and stored
   * over the other tab's, which a toast says. Each tab keeps its own
   * Monitors, as Go live is per tab.
   */
  const takeOtherTabPatch = (stored: NodeGraph, previous: NodeGraph | null) => {
    const local = store.state.graph;
    if (!local || isReadOnly()) {
      return;
    }
    const migration = migrateNodeGraph(stored);
    if (migration.status !== "ok") {
      return;
    }
    const latest = getPlaybackSession("node")?.graph;
    if (local !== observedGraph || !latest || !isSamePatch(latest, stored)) {
      reportPatchConflict();
      return;
    }
    const graph = withMonitorsFrom(migration.graph, local);
    adoptedGraph = graph;
    takeOtherTabNodeGraph(graph, previous, () => adoptNodeGraph(graph, store));
  };

  /**
   * Another tab wrote the sessions. A Node patch that changed is taken in
   * once the NAM models it holds are cached, so its amps load as they do
   * after a reload; a newer write supersedes one still loading.
   */
  const onOtherTabWrite = () => {
    const stored = getPlaybackSession("node")?.graph ?? null;
    if (!(active && stored) || stored === seenStoredGraph) {
      return;
    }
    const previous = seenStoredGraph;
    seenStoredGraph = stored;
    if (previous && isSamePatch(previous, stored)) {
      return;
    }
    otherTabGeneration += 1;
    const generation = otherTabGeneration;
    hydrateNodeGraphNamModels([stored])
      .then(() => {
        if (active && generation === otherTabGeneration) {
          takeOtherTabPatch(stored, previous);
        }
      })
      .catch(reportNodeFailure("Could not take in another tab's patch"));
  };

  const flushBeforeLeave = () => {
    applyPendingCommit();
    persistence.flush();
  };
  const flushWhenHidden = () => {
    if (globalThis.document?.hidden) {
      flushBeforeLeave();
    }
  };

  const stopListening = () => {
    persistence.flush();
    globalThis.removeEventListener?.("pagehide", flushBeforeLeave);
    globalThis.document?.removeEventListener(
      "visibilitychange",
      flushWhenHidden
    );
    active = false;
    subscription?.unsubscribe();
    subscription = null;
    stopOtherTabWrites?.();
    stopOtherTabWrites = null;
    otherTabGeneration += 1;
  };

  const updateSource = (
    nodeId: string,
    update: (data: SourceData) => Partial<SourceData>
  ) => {
    commitNodeGraph(
      (graph) => ({
        ...graph,
        nodes: graph.nodes.map((node): GraphNode => {
          if (node.id !== nodeId) {
            return node;
          }
          if (isRadioSourceNode(node)) {
            return {
              ...node,
              data: { ...node.data, ...update(node.data) },
            } as GraphNode;
          }
          if (node.type === "deviceIn") {
            return { ...node, data: { ...node.data, ...update(node.data) } };
          }
          return node;
        }),
      }),
      store
    );
  };

  const setVolume = (nodeId: string, volume: number) => {
    if (volume > 0) {
      unmutedVolumes.set(nodeId, volume);
    }
    updateSource(nodeId, ({ muted }) => ({
      muted: volume > 0 ? false : muted,
      volume,
    }));
  };

  const setMasterVolume = (volume: number) => {
    persistence.flush();
    if (isReadOnly()) {
      return;
    }
    if (volume > 0) {
      unmutedMasterVolume = volume;
    }
    setManagedSessionMasterVolume("node", volume, ctx);
  };

  /**
   * A Go live that didn't go live, e.g. a cancelled picker or a denied mic,
   * turns its Monitor back off.
   */
  const resetFailedMonitor = (nodeId: string) => {
    const runtime = getPlaybackChannelRuntime(laneChannelId(nodeId));
    const node = store.state.graph?.nodes.find((entry) => entry.id === nodeId);
    if (
      node?.type !== "deviceIn" ||
      !node.data.strip.monitor ||
      runtime.isPlaying ||
      runtime.isLoading
    ) {
      return;
    }
    commitNodeGraph(
      (graph) => setSourceStrip(graph, nodeId, { monitor: false }),
      store,
      "rebase"
    );
  };

  const setPlaying = async (nodeId: string, playing: boolean) => {
    if (lanePlan(nodeId)?.source.kind === "device") {
      // Monitor follows Go live, and no undo step toggles a mic.
      commitNodeGraph(
        (graph) => setSourceStrip(graph, nodeId, { monitor: playing }),
        store,
        "rebase"
      );
    }
    if (!playing) {
      clearManagedPlaybackErrors([laneChannelId(nodeId)]);
      engine?.pause(nodeId);
      return;
    }
    if (!engine || isReadOnly()) {
      return;
    }
    if ((await engine.play(nodeId)) !== "cancelled") {
      resetFailedMonitor(nodeId);
    }
  };

  return {
    async activate() {
      const session = await getReadyManagedPlaybackSession("node");
      stopListening();
      await disposeEngine();
      const migration = migrateNodeGraph(
        session.graph ?? buildNodeGraphFromTemplate("starter")
      );
      loadNodeGraphMigration(
        migration.status === "ok"
          ? { ...migration, graph: withMonitorsOff(migration.graph) }
          : migration,
        store
      );
      observedGraph = store.state.graph;
      seenStoredGraph = session.graph ?? null;
      adoptedGraph = null;
      engine = createEngine();
      active = true;
      subscription = store.subscribe(onStoreChange);
      globalThis.addEventListener?.("pagehide", flushBeforeLeave);
      globalThis.document?.addEventListener(
        "visibilitychange",
        flushWhenHidden
      );
      stopOtherTabWrites = otherTabWrites(onOtherTabWrite);
      if (migration.status !== "ok") {
        return;
      }
      try {
        reconcile(true);
      } catch (error) {
        // The manager reports this mode inactive: release the lanes made
        // before the failing one.
        stopListening();
        await disposeEngine();
        throw error;
      }
      applySessionMasterVolume("node", ctx);
      if (session.masterVolume > 0) {
        unmutedMasterVolume = session.masterVolume;
      }
      for (const node of store.state.graph?.nodes ?? []) {
        if (
          (isRadioSourceNode(node) || node.type === "deviceIn") &&
          node.data.volume > 0
        ) {
          unmutedVolumes.set(node.id, node.data.volume);
        }
      }
    },
    async deactivate() {
      persistence.flush();
      // A commit still queued in this tick's batch would be dropped once
      // listening stops; persist it so the next activation loads it.
      const pendingGraph = store.state.graph;
      if (active && pendingGraph && pendingGraph !== observedGraph) {
        const previousChannels = getPlaybackSession("node")?.channels ?? [];
        updatePlaybackSession("node", (draft) => {
          draft.graph = pendingGraph;
          draft.channels = deriveNodeChannels(
            compiledPlan(pendingGraph, getEnv()),
            previousChannels
          );
        });
      }
      stopListening();
      observedGraph = null;
      await disposeEngine();
    },
    flush() {
      applyPendingCommit();
      persistence.flush();
    },
    jumpToCue(nodeId) {
      const node = findSource(store.state.graph, nodeId);
      const cue = node && "cue" in node.data.strip ? node.data.strip.cue : null;
      const soundId = engine?.soundOf(nodeId);
      if (lanePlan(nodeId)?.transport && soundId && cue !== null) {
        seekSound(ctx.audioEngine.playback, soundId, cue);
      }
    },
    pauseAll() {
      engine?.pauseAll();
    },
    async playAll() {
      if (engine && !isReadOnly()) {
        await engine.playAll();
      }
    },
    async playTrack(nodeId, streamUrl) {
      const source = findSource(store.state.graph, nodeId);
      if (active && engine && isRadioSourceNode(source)) {
        await engine.playTrack(nodeId, streamUrl);
      }
    },
    retryOutputDevice(nodeId) {
      applyPendingCommit();
      engine?.retryOutputDevice(nodeId);
    },
    seek(nodeId, position) {
      const soundId = engine?.soundOf(nodeId);
      if (lanePlan(nodeId)?.transport && soundId) {
        seekSound(ctx.audioEngine.playback, soundId, position);
      }
    },
    setCue(nodeId) {
      const soundId = engine?.soundOf(nodeId);
      const position = soundId
        ? ctx.audio.getTrackProgress(soundId)?.position
        : undefined;
      if (
        !lanePlan(nodeId)?.transport ||
        position === undefined ||
        !Number.isFinite(position)
      ) {
        return;
      }
      commitNodeGraph(
        (graph) =>
          setSourceStrip(graph, nodeId, { cue: Math.max(0, position) }),
        store,
        "snapshot"
      );
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
      const source = findSource(store.state.graph, nodeId);
      if (!source) {
        return;
      }
      const { muted, volume } = source.data;
      if (volume === 0) {
        setVolume(nodeId, unmutedVolumes.get(nodeId) ?? 1);
        return;
      }
      updateSource(nodeId, () => ({ muted: !muted }));
    },
    whenSettled,
  };
}

export function getNodePlayback(
  options: GetNodePlaybackOptions = {}
): NodePlayback {
  const ctx = options.ctx ?? getDefaultPlaybackActionContext();
  const existing = instances.get(ctx);
  if (existing) {
    return existing;
  }
  const playback = createNodePlayback(ctx, {
    backendBadges: options.backendBadges ?? nodeBackendBadges,
    cueOutput: options.cueOutput ?? getOutputRouting,
    deviceSinks: options.deviceSinks ?? createNodeDeviceSinks,
    effects: options.effects ?? {
      reconcileEffects: (soundId, desired) =>
        ctx.audio.reconcileEffects(soundId, desired),
      setEffectFields: (soundId, effectId, config) =>
        ctx.audio.setEffectFields(soundId, effectId, config),
    },
    fadeOutDurationMs:
      options.fadeOutDurationMs ?? DEFAULT_FADE_OUT_DURATION_MS,
    fadeOutSound: options.fadeOutSound ?? fadeOut,
    getEnv: options.getEnv ?? detectNodePlaybackEnv,
    laneOutputs: options.laneOutputs ?? createNodeLaneOutputs,
    otherTabWrites: options.otherTabWrites ?? subscribeToOtherTabSessionWrites,
    resolveStream: options.resolveStream ?? resolveDjPlatformStreamUrl,
    sinkStatuses: options.sinkStatuses ?? nodeSinkStatuses,
    store: options.store ?? nodeStore,
  });
  instances.set(ctx, playback);
  return playback;
}
