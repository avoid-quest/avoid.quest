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
 * gain.
 *
 * Each lane reaches its outputs through its own `laneOut` gain
 * (node-lane-outputs), registered as the sound's output connector before it
 * first plays, which fans out into one send per output. Cable gain and mute
 * ramp each send to the sum of the lane's unmuted cables into that output,
 * so a Station with no cable to Speakers plays silent. Speakers sends go to
 * the main bus; an Output device's go to its device sink
 * (node-device-sinks), or to the main bus while that sink can't play. An FX
 * layout change ducks laneOut around the tree swap. The source's fader
 * stays the volume controller's; nothing here writes it.
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
 * A Track or File lane watches its sound. A platform stream that expires
 * on first play or mid-play is renewed through DJ's refresh
 * (platform-stream-refresh) and resumes where it stopped; at the end of a
 * track in an album or playlist, the lane moves to the next one and plays
 * it. A local file's sound is made
 * on play, since restore never prepares one.
 *
 * Each lane with FX publishes a backend badge for its FX nodes: `compat`
 * from the compile estimate until the effects controller reports, then from
 * the controller's outcome, so a dry fallback reads `bypassed`.
 *
 * Starting and stopping keeps Multiple's rules: start ownership, revisions
 * and cancellation, Play all with at most 3 starts in flight, and a fade-out
 * deactivate that releases every `n:*` channel before the orphan check. A
 * stream start past the playing-stream budget is refused with a message.
 */

import { Store } from "@tanstack/react-store";
import type { AudioState, Radio } from "@/lib/audio";
import { fadeOut } from "@/lib/audio";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import { isEffectContainer } from "@/lib/audio/dsp/routing/effect-tree";
import {
  createNodeDeviceSinks,
  type DeviceSinkStatus,
  type NodeDeviceSinks,
  type NodeDeviceSinksOptions,
} from "@/lib/audio/routing/node-device-sinks";
import {
  createNodeLaneOutputs,
  type LaneSinkRoute,
  type NodeLaneOutputs,
  type NodeLaneOutputsOptions,
} from "@/lib/audio/routing/node-lane-outputs";
import {
  getNodeSessionReadOnlyVersion,
  getPlaybackChannel,
  getPlaybackSession,
  type PlaybackChannelRecord,
  updatePlaybackSession,
} from "@/lib/collections/playback-sessions";
import {
  type DeviceInputAudio,
  isDisplayAudioCancel,
  startDeviceInput,
} from "@/lib/device-input-playback";
import { findNextTrack } from "@/lib/dj-actions-playlist";
import { resolveDjPlatformStreamUrl } from "@/lib/dj-platform-stream-port";
import {
  type ChannelSelectionPlan,
  compile,
  type EnginePlan,
  type LaneBackend,
  type LanePlan,
  type LaneSource,
  laneChannelId,
} from "@/lib/node-graph/compile";
import {
  setSourceRadio,
  setSourceStrip,
  withMonitorsOff,
} from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  loadNodeGraphMigration,
  type NodeStore,
  nodeStore,
} from "@/lib/node-graph/node-store";
import { diff, type Op } from "@/lib/node-graph/reconcile";
import {
  type GraphNode,
  isRadioSourceNode,
  migrateNodeGraph,
  type NodeGraph,
} from "@/lib/node-graph/schema";
import { deriveNodeChannels } from "@/lib/node-graph/session-channels";
import { isTrackRadio, retainLocalFileUrl } from "@/lib/node-graph/sources";
import { buildNodeGraphFromTemplate } from "@/lib/node-graph/templates";
import { NODE_BUDGETS, type Profile } from "@/lib/node-graph/validate";
import {
  type CueDeckRegistration,
  getOutputRouting,
  type OutputRouting,
} from "@/lib/output-routing.js";
import {
  getRefreshRequest,
  type ResolvePlatformStream,
  radioOnTrack,
  refreshPlatformStream,
} from "@/lib/platform-stream-refresh";
import {
  repeatAtEnd,
  seekSound,
  setPlaybackRate,
  setPreservesPitch,
} from "@/lib/source-strip";
import {
  getPlaybackChannelRuntime,
  getPlaybackRuntimeChannelIds,
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import {
  type ChannelEffects,
  type ChannelEffectsResult,
  channelEffects,
  type EffectsRuntimeOutcome,
} from "./channel-effects.js";
import {
  clearManagedPlaybackErrors,
  getChannelPlayVolume,
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
import { createPendingChannelStarts } from "./pending-channel-starts.js";
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
  createManagedSound,
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

type EffectsBackend = EffectsRuntimeOutcome["backend"];

/**
 * A lane's badge: the controller's outcome once it reported one, else the
 * compile estimate. The estimate is only displayed; the controller decides,
 * so an official lane past the runtime cap flips to `compat`.
 */
export function laneBackendBadge(
  estimate: LaneBackend | null,
  outcome: EffectsBackend | undefined
): BackendBadge | null {
  if (estimate === null) {
    return null;
  }
  switch (outcome) {
    case "bypass":
      return "bypassed";
    case "compatibility":
      return "compat";
    case "official":
      return null;
    default:
      return estimate === "compat" ? "compat" : null;
  }
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

export type GetNodePlaybackOptions = {
  /** Where lane backend badges are published for the canvas and Rack. */
  backendBadges?: NodeBackendBadgeStore;
  ctx?: PlaybackActionContext;
  deviceSinks?: (options: NodeDeviceSinksOptions) => NodeDeviceSinks;
  effects?: Pick<ChannelEffects, "change">;
  fadeOutDurationMs?: number;
  fadeOutSound?: FadeOutSound;
  getEnv?: () => NodePlaybackEnv;
  laneOutputs?: (options: NodeLaneOutputsOptions) => NodeLaneOutputs;
  /** Renews an expired platform stream, or resolves a `yt:` track. */
  resolveStream?: ResolvePlatformStream;
  /** Where Output device sink statuses are published for their bodies. */
  sinkStatuses?: NodeSinkStatusStore;
  store?: NodeStore;
  /**
   * The headphone cue bus a Track's or File's cue listen taps into. Its
   * settings are applied as a tap goes on, as a DJ deck's CUE does, since
   * Node mode alone never builds the cue output.
   */
  cueOutput?: () => Pick<
    OutputRouting,
    "applySettings" | "registerCueDeck" | "releaseCue"
  >;
};

type PlaybackCancellation = "deactivate" | "pause" | "remove";

type PlayAllGeneration = { cancellation: PlaybackCancellation | null };

type ChannelStartOwnership = {
  cancellation: PlaybackCancellation | null;
  cancellationRevision: number | null;
  channelId: string;
  revision: number;
};

/** A Track or File sound being watched; each remade sound gets a new one. */
type LaneWatch = { soundId: string };

/** A source's own level: a Station's, Track's, File's or Audio input's. */
type SourceData = { volume: number; muted: boolean };

type DeviceLaneSource = Extract<LaneSource, { kind: "device" }>;

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

/** A lane failure the lane shows as it is worded, e.g. a refresh that failed. */
function laneFailure(
  channelId: string,
  userMessage: string,
  cause: unknown
): PlaybackActionError {
  return {
    cause,
    channelId,
    code: "PLAY_ERROR",
    mode: "node",
    radio: getPlaybackChannel("node", channelId)?.radio ?? undefined,
    rawMessage: cause instanceof Error ? cause.message : null,
    userMessage,
  };
}

/** A device start through AudioManager, as DJ decks make it. */
function deviceInputAudio(ctx: PlaybackActionContext): DeviceInputAudio {
  return {
    // Only an open capture has channels; a start that didn't open one
    // reads null, so a shared tab's stream is stopped, as on a DJ deck.
    getDeviceChannelCount: (soundId) => {
      const capture = ctx.audio.getDeviceSource(soundId);
      return capture?.isActive ? capture.channelCount : null;
    },
    startDevice: (soundId, deviceId, constraints, channelSelection) =>
      ctx.audio.playDeviceSound(
        soundId,
        deviceId,
        constraints,
        channelSelection
      ),
  };
}

function canRenewTrack(radio: Radio, error: unknown): boolean {
  return (
    isTrackRadio(radio) &&
    getRefreshRequest(radio) !== null &&
    !(
      error instanceof DOMException &&
      ["AbortError", "NotAllowedError"].includes(error.name)
    )
  );
}

function createNodePlayback(
  ctx: PlaybackActionContext,
  {
    backendBadges,
    cueOutput,
    deviceSinks: createDeviceSinks,
    effects,
    fadeOutDurationMs,
    fadeOutSound,
    getEnv,
    laneOutputs: createLaneOutputs,
    resolveStream,
    sinkStatuses,
    store,
  }: Required<Omit<GetNodePlaybackOptions, "ctx">>
): NodePlayback {
  const activeChannelStarts = new Set<ChannelStartOwnership>();
  const pendingChannelStarts = createPendingChannelStarts();
  const activePlayAllGenerations = new Set<PlayAllGeneration>();
  const channelStartRevisions = new Map<string, number>();
  const unmutedVolumes = new Map<string, number>();
  const fileSoundReleases = new Map<string, () => void>();
  let unmutedMasterVolume = 1;

  let plan = EMPTY_PLAN;
  let active = false;
  const isReadOnly = () =>
    store.state.readOnlyVersion !== null ||
    getNodeSessionReadOnlyVersion() !== null;
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
  /** Lanes removed in this batch, whose cable ops run before the removal. */
  const removingLanes = new Set<string>();
  /** Lanes a track change starts itself, so their carry doesn't resume. */
  const explicitStarts = new Set<string>();
  const laneGenerations = new Map<string, number>();
  /** Per lane: the backend its effects last settled on, as reported. */
  const laneOutcomes = new Map<string, EffectsBackend>();
  /**
   * Per Track or File channel: the watch on its sound. A lane's sound id
   * never changes, so a sound remade for another track gets a new watch,
   * and a refresh or next track started for the old one is dropped.
   */
  const laneWatches = new Map<string, LaneWatch>();
  /** Channels moving to their next track, so an end is handled once. */
  const advancingLanes = new Set<string>();
  /**
   * Interrupted streams renewing their URL. Their runtime says neither
   * playing nor loading meanwhile, yet each resumes, so it keeps its slot
   * in the stream budget until a pause, removal or deactivate cancels it.
   */
  const refreshingStreams = new Set<{
    channelId: string;
    isCurrent: () => boolean;
  }>();
  /** Per channel: its sound's pre-fader tap on the headphone cue bus. */
  const cueTaps = new Map<
    string,
    { soundId: string; registration: CueDeckRegistration }
  >();
  /** Whether a tap opened the cue output since activation. */
  let cueOpened = false;

  /**
   * A lane's level per output: the gains of its unmuted cables into it,
   * summed. A muted Output device takes nothing.
   */
  const laneLevels = (laneId: string) => {
    const levels = new Map<string, number>();
    for (const edge of plan.edges.values()) {
      if (edge.from.id !== laneId) {
        continue;
      }
      const sinkId = edge.to.id;
      const silenced = edge.muted || plan.sinks.get(sinkId)?.muted === true;
      levels.set(
        sinkId,
        (levels.get(sinkId) ?? 0) + (silenced ? 0 : edge.gain)
      );
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

  const laneOutputs = createLaneOutputs({
    getHost: () => ctx.audio,
    getLevels: laneLevels,
    // A new sound's nodes exist from its connect, before its playback starts.
    onConnect: (laneId) => applyLaneStrip(laneChannelId(laneId)),
    route: routeSink,
  });

  const deviceSinks = createDeviceSinks({
    getPlaybackEpoch: () => epoch,
    onReroute: (sinkId) => laneOutputs.reroute(sinkId),
    onStatus: () => publishSinkStatuses(),
  });

  const publishSinkStatuses = () => {
    sinkStatuses.setState(() => deviceSinks.statuses());
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

  const laneOfChannel = (channelId: string) =>
    plan.lanes.get(channelId.slice(NODE_CHANNEL_PREFIX.length));

  const isDeviceChannel = (channelId: string) =>
    laneOfChannel(channelId)?.source.kind === "device";

  /** Writes every lane's badge, and its FX nodes', when one changed. */
  const publishBadges = () => {
    const badges: Record<string, BackendBadge> = {};
    for (const lane of plan.lanes.values()) {
      const badge = laneBackendBadge(lane.backend, laneOutcomes.get(lane.id));
      if (!badge) {
        continue;
      }
      badges[lane.id] = badge;
      for (const id of enabledEffectIds(lane.effects)) {
        badges[id] = badge;
      }
    }
    if (!sameBadges(backendBadges.state, badges)) {
      backendBadges.setState(() => badges);
    }
  };

  /**
   * Keeps what the controller reported for a lane still in the plan. An
   * inactive outcome means no effects graph yet, so the estimate shows. A
   * ready `bypass` only means nothing was on to process (every FX off), not
   * a dry fallback, so it is not kept: switching an FX back on must not
   * read `bypassed` while the new runtime connects.
   */
  const recordOutcome = (
    laneId: string,
    outcome: EffectsRuntimeOutcome | undefined
  ) => {
    if (
      !(outcome && plan.lanes.has(laneId)) ||
      outcome.status === "superseded"
    ) {
      return;
    }
    if (
      outcome.status === "inactive" ||
      (outcome.backend === "bypass" && outcome.status !== "failed")
    ) {
      laneOutcomes.delete(laneId);
    } else {
      laneOutcomes.set(laneId, outcome.backend);
    }
    publishBadges();
  };

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

  /**
   * Goes live on an Audio input: its sound is made now, never on restore,
   * so the mic opens only from a gesture. A lane muted live keeps its
   * capture open, so going live again only lifts its gain, as on a DJ deck,
   * unless the device was unplugged meanwhile: that capture opens anew.
   */
  const startDeviceLane = async (
    channel: PlaybackChannelRecord,
    source: DeviceLaneSource,
    isCurrent: () => boolean
  ) => {
    const { radio } = channel;
    if (!radio) {
      return;
    }
    let { soundId } = getPlaybackChannelRuntime(channel.id);
    if (!soundId) {
      soundId = createManagedSound("node", channel.id, radio, undefined, ctx);
      ctx.channels.setMuted("node", channel.id, channel.muted);
    }
    applySessionMasterVolume("node", ctx);
    const capture = ctx.audio.getDeviceSource(soundId);
    // An unplugged device leaves its capture "active" on an ended track.
    if (capture?.isActive && capture.getDiagnostics()?.readyState !== "ended") {
      await ctx.audio.playSound(soundId, getChannelPlayVolume(channel));
      return;
    }
    // A dead capture goes, with its tracks and device listener, before the
    // new one replaces it.
    capture?.cleanup();
    ctx.audioEngine.volume.setChannelVolume(
      soundId,
      getChannelPlayVolume(channel)
    );
    await startDeviceInput(
      deviceInputAudio(ctx),
      soundId,
      source,
      isCurrent,
      (isLoading) =>
        setPlaybackChannelRuntime(channel.id, () => ({ isLoading }))
    );
    // A fader changed during the permission prompt keeps its latest value.
    const latest = getPlaybackChannel("node", channel.id);
    if (latest && !latest.muted) {
      ctx.channels.setVolume("node", channel.id, latest.volume);
    }
  };

  const setChannelPlaying = async (
    channelId: string,
    playing: boolean,
    revision: number,
    shouldReportError = () => channelStartRevisions.get(channelId) === revision
  ) => {
    clearManagedPlaybackErrors([channelId]);
    const channel = getPlaybackChannel("node", channelId);
    const source = laneOfChannel(channelId)?.source;
    const { soundId } = getPlaybackChannelRuntime(channelId);
    const position =
      playing && isTrackRadio(channel?.radio) && soundId
        ? (ctx.audio.getTrackProgress(soundId)?.position ?? 0)
        : 0;
    try {
      if (playing && channel && source?.kind === "device") {
        await startDeviceLane(channel, source, shouldReportError);
      } else {
        if (playing && channel) {
          makeTrackSound(channel);
        }
        await setManagedChannelPlaying("node", channel, playing, ctx);
      }
      return true;
    } catch (error) {
      if (
        playing &&
        channel?.radio &&
        canRenewTrack(channel.radio, error) &&
        shouldReportError()
      ) {
        return await recoverTrackStart(channel, position, shouldReportError);
      }
      if (shouldReportError() && !isDisplayAudioCancel(error)) {
        const radio = channel?.radio ?? undefined;
        const reportedError = reportPlaybackActionError(ctx.reportError, {
          cause: error,
          channelId,
          code: "PLAY_ERROR",
          mode: "node",
          radio,
        });
        setManagedPlaybackError(channelId, reportedError, radio);
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
    pendingChannelStarts.cancel(channelId);
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

  /**
   * Streams playing, loading or starting, other than `channelId`. A live
   * input is no stream, so it doesn't count.
   */
  const countBusyStreams = (channelId: string) => {
    const busy = new Set(
      getPlaybackRuntimeChannelIds().filter((id) => {
        if (!isNodeChannelId(id) || isDeviceChannel(id)) {
          return false;
        }
        const runtime = getPlaybackChannelRuntime(id);
        return runtime.isPlaying || runtime.isLoading;
      })
    );
    for (const ownership of activeChannelStarts) {
      if (
        ownership.cancellation === null &&
        !isDeviceChannel(ownership.channelId)
      ) {
        busy.add(ownership.channelId);
      }
    }
    for (const refresh of refreshingStreams) {
      if (refresh.isCurrent()) {
        busy.add(refresh.channelId);
      }
    }
    busy.delete(channelId);
    return busy.size;
  };

  /**
   * Writes a lane's native strip onto its sound's nodes, once it has them:
   * a sound without nodes gets it as they connect. Both halves are always
   * written, so a pan back to centre or a removed filter reaches a sound
   * that still holds the old values.
   */
  const applyLaneStrip = (channelId: string) => {
    const lane = laneOfChannel(channelId);
    const { soundId } = getPlaybackChannelRuntime(channelId);
    if (!(lane && soundId && ctx.audio.getPreFaderNode(soundId))) {
      return;
    }
    ctx.audio.setPan(soundId, lane.pan);
    ctx.audio.updateFilter(
      soundId,
      lane.filter ? { ...lane.filter, enabled: true, gain: 0 } : BYPASS_FILTER
    );
  };

  /**
   * A Track's or File's speed and key lock, through the strip calls DJ
   * decks share. Written once its sound plays, since a load resets the
   * media element's rate, and on each change.
   */
  const applyLaneTransport = (channelId: string) => {
    const transport = laneOfChannel(channelId)?.transport;
    const { soundId } = getPlaybackChannelRuntime(channelId);
    if (!(transport && soundId)) {
      return;
    }
    setPlaybackRate(ctx.audio, soundId, transport.speed);
    setPreservesPitch(ctx.audio, soundId, transport.keyLock);
  };

  /**
   * Taps a lane pre-fader onto the headphone cue bus while its cue listen
   * is on, as a DJ deck's CUE does, or takes the tap off. The tap exists
   * once the sound plays.
   */
  const syncCueTap = (channelId: string) => {
    const lane = laneOfChannel(channelId);
    const { soundId } = getPlaybackChannelRuntime(channelId);
    const current = cueTaps.get(channelId);
    if (!(lane?.cueListen && soundId)) {
      current?.registration.cleanup();
      cueTaps.delete(channelId);
      return;
    }
    const tap = ctx.audio.getPreFaderNode(soundId);
    if (current?.soundId === soundId) {
      current.registration.replaceTap(tap);
      current.registration.setEnabled(true);
      return;
    }
    current?.registration.cleanup();
    const output = cueOutput();
    cueOpened = true;
    cueTaps.set(channelId, {
      registration: output.registerCueDeck(`node:${lane.id}`, tap, true),
      soundId,
    });
    // The cue sink exists only once the stored cue output is applied; the
    // tap connects to it then.
    output.applySettings().catch(warn("Could not open the cue output"));
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
    const startEpoch = epoch;
    const pending = pendingChannelStarts.begin(
      channelId,
      () => epoch === startEpoch
    );
    try {
      await settling;
    } finally {
      pending.release();
    }
    return pending.isCurrent();
  };

  /**
   * Once a lane plays: its native strip, its transport and cue tap, and the
   * backend its effects graph settled on, which the play call awaited while
   * it connected.
   */
  const settleStartedLane = (channelId: string, lane: LanePlan | undefined) => {
    applyLaneStrip(channelId);
    applyLaneTransport(channelId);
    syncCueTap(channelId);
    if (lane) {
      recordOutcome(lane.id, ctx.audio.getEffectsRuntimeOutcome(lane.soundId));
    }
  };

  const startWritableChannel = async (
    channelId: string,
    isCurrent = () => true
  ) => {
    // Without a settling lane this stays synchronous up to the play call,
    // inside the user's gesture.
    if (
      settlingLanes.has(channelId.slice(NODE_CHANNEL_PREFIX.length)) &&
      !(await awaitLaneSettled(channelId))
    ) {
      return;
    }
    if (!isCurrent()) {
      return;
    }
    const limit = NODE_BUDGETS[getEnv().profile].playingStreams;
    if (!isDeviceChannel(channelId) && countBusyStreams(channelId) >= limit) {
      setManagedPlaybackError(channelId, budgetError(limit, channelId));
      return;
    }
    const nodeId = channelId.slice(NODE_CHANNEL_PREFIX.length);
    const lane = plan.lanes.get(nodeId);
    if (lane) {
      // Before the play call: the sound's graph connects inside it.
      laneOutputs.attach(nodeId, lane.soundId);
    }
    // A sound that played before resumes on its nodes at the play call, so
    // its strip goes on first; a new sound's goes on as it connects.
    applyLaneStrip(channelId);
    const ownership = beginChannelStart(channelId);
    const ownsStart = () =>
      isCurrent() &&
      ownership.cancellation === null &&
      channelStartRevisions.get(channelId) === ownership.revision;
    try {
      const started = await setChannelPlaying(
        channelId,
        true,
        ownership.revision,
        ownsStart
      );
      if (started && ownsStart()) {
        // Again once it plays, for nodes the start built later.
        settleStartedLane(channelId, lane);
      }
    } finally {
      activeChannelStarts.delete(ownership);
      if (
        ownership.cancellation !== null &&
        channelStartRevisions.get(channelId) === ownership.cancellationRevision
      ) {
        const cancel =
          ownership.cancellation === "pause" ? pauseChannel : releaseChannel;
        cancel(channelId);
      }
    }
  };

  const startChannel = (channelId: string, isCurrent = () => true) =>
    isReadOnly()
      ? Promise.resolve()
      : startWritableChannel(channelId, isCurrent);

  /** Releases a channel's sound, its runtime, its watch and its cue tap. */
  const releaseChannel = (channelId: string) => {
    cueTaps.get(channelId)?.registration.cleanup();
    cueTaps.delete(channelId);
    laneWatches.delete(channelId);
    cleanupManagedChannel(channelId, ctx);
    resetPlaybackChannelRuntime(channelId);
    fileSoundReleases.get(channelId)?.();
    fileSoundReleases.delete(channelId);
  };

  const reportLaneFailure = (
    channelId: string,
    message: string,
    cause: unknown = null
  ) => {
    const error = laneFailure(channelId, message, cause);
    ctx.reportError(error);
    setManagedPlaybackError(channelId, error, error.radio);
  };

  /** One renewal and retry when a persisted platform URL fails to start. */
  const recoverTrackStart = async (
    channel: PlaybackChannelRecord,
    position: number,
    ownsStart: () => boolean
  ) => {
    const { radio } = channel;
    const { soundId } = getPlaybackChannelRuntime(channel.id);
    const watch = laneWatches.get(channel.id);
    if (!(radio && soundId && watch)) {
      return false;
    }
    const startEpoch = epoch;
    const pending = pendingChannelStarts.begin(
      channel.id,
      () =>
        active &&
        epoch === startEpoch &&
        ownsStart() &&
        laneWatches.get(channel.id) === watch &&
        getPlaybackChannelRuntime(channel.id).soundId === soundId
    );
    const { isCurrent } = pending;
    let started = false;
    try {
      await refreshPlatformStream(radio, soundId, position, {
        isCurrent,
        onFailed: (request, error) =>
          reportLaneFailure(channel.id, request.failureMessage, error),
        onRefreshed: () => {
          started = true;
          setPlaybackChannelRuntime(channel.id, () => ({ error: null }));
        },
        onUnresolved: (request) =>
          reportLaneFailure(channel.id, request.failureMessage),
        refresh: async (id, streamUrl, seekPosition, streamFormat) => {
          await ctx.audioEngine.playback.refreshStreamUrl(
            id,
            streamUrl,
            seekPosition,
            streamFormat
          );
          if (isCurrent()) {
            await setManagedChannelPlaying("node", channel, true, ctx);
          }
        },
        resolveStream,
      });
      return started;
    } finally {
      pending.release();
    }
  };

  /**
   * Moves a Track or File lane to another of its tracks, as one commit that
   * folds into the next undo step, then plays it once the old sound fades.
   */
  const playLaneTrack = async (
    nodeId: string,
    radio: Radio,
    isCurrent = () => true
  ) => {
    const committed = commitNodeGraph(
      (graph) => setSourceRadio(graph, nodeId, radio),
      store
    );
    if (!committed) {
      return;
    }
    // This start replaces the lane's carried resume, which would start the
    // same sound a second time.
    explicitStarts.add(nodeId);
    try {
      applyPendingCommit();
    } finally {
      explicitStarts.delete(nodeId);
    }
    await startChannel(laneChannelId(nodeId), isCurrent);
  };

  /**
   * At the end of a track in an album or playlist, the lane moves to the
   * next one (findNextTrack, as a DJ deck's autoplay), resolving a `yt:`
   * track first. The last track just ends.
   */
  const advanceLane = async (channelId: string, isCurrent: () => boolean) => {
    const lane = laneOfChannel(channelId);
    const radio = lane?.radio as Radio | undefined;
    const next = radio ? findNextTrack(radio) : null;
    if (!(lane && radio && next) || advancingLanes.has(channelId)) {
      return;
    }
    const pending = pendingChannelStarts.begin(channelId, isCurrent);
    const canAdvance = pending.isCurrent;
    advancingLanes.add(channelId);
    try {
      const nextRadio = await radioOnTrack(
        radio,
        next.streamUrl,
        resolveStream
      );
      if (!canAdvance()) {
        return;
      }
      pending.release();
      if (nextRadio) {
        await playLaneTrack(lane.id, nextRadio);
      } else {
        reportLaneFailure(channelId, "Couldn't load the next track");
      }
    } catch (error) {
      if (canAdvance()) {
        reportLaneFailure(channelId, "Couldn't load the next track", error);
      }
    } finally {
      pending.release();
      advancingLanes.delete(channelId);
    }
  };

  /**
   * Plays an ended Track or File again from its start: its loop, through
   * the whole-track repeat DJ decks use.
   */
  const repeatLane = async (
    channelId: string,
    soundId: string,
    isCurrent: () => boolean
  ) => {
    if (advancingLanes.has(channelId)) {
      return;
    }
    advancingLanes.add(channelId);
    try {
      const repeated = await repeatAtEnd({
        isCurrent,
        play: () => {
          const channel = getPlaybackChannel("node", channelId);
          return ctx.audio.playSound(
            soundId,
            channel ? getChannelPlayVolume(channel) : 1
          );
        },
        seek: () => seekSound(ctx.audioEngine.playback, soundId, 0),
      });
      if (repeated) {
        settleStartedLane(channelId, laneOfChannel(channelId));
      }
    } catch (error) {
      if (isCurrent()) {
        reportLaneFailure(channelId, "Couldn't repeat the track", error);
      }
    } finally {
      advancingLanes.delete(channelId);
    }
  };

  /**
   * A Track or File sound's state: an expired platform stream is renewed
   * and resumes at its position; an ended track repeats when its strip
   * loops, or else moves to the next.
   */
  const handleTrackState = (
    channelId: string,
    watch: LaneWatch,
    state: AudioState
  ) => {
    const { soundId } = watch;
    const isCurrent = () =>
      laneWatches.get(channelId) === watch &&
      getPlaybackChannelRuntime(channelId).soundId === soundId;
    const radio = laneOfChannel(channelId)?.radio as Radio | undefined;
    if (!(radio && isCurrent())) {
      return;
    }
    if (state.error?.code === "STREAM_INTERRUPTED") {
      // The sound repeats its error with each state until it resumes; one
      // renewal at a time.
      for (const refresh of refreshingStreams) {
        if (refresh.channelId === channelId && refresh.isCurrent()) {
          return;
        }
      }
      // A pause, removal or deactivate while it resolves drops the resume.
      const pending = pendingChannelStarts.begin(channelId, isCurrent);
      const refresh = { channelId, isCurrent: pending.isCurrent };
      const canRefresh = pending.isCurrent;
      refreshingStreams.add(refresh);
      track(
        refreshPlatformStream(radio, soundId, state.error.position ?? 0, {
          isCurrent: canRefresh,
          onFailed: (request, error) =>
            reportLaneFailure(channelId, request.failureMessage, error),
          onRefreshed: () =>
            setPlaybackChannelRuntime(channelId, () => ({ error: null })),
          onUnresolved: (request) =>
            reportLaneFailure(channelId, request.failureMessage),
          refresh: (id, streamUrl, position, streamFormat) =>
            ctx.audioEngine.playback.refreshStreamUrl(
              id,
              streamUrl,
              position,
              streamFormat
            ),
          resolveStream,
        }).finally(() => {
          pending.release();
          refreshingStreams.delete(refresh);
        })
      ).catch(warn("Could not refresh a stream"));
      return;
    }
    if (state.hasEnded && !state.isPlaying) {
      if (laneOfChannel(channelId)?.transport?.loop) {
        track(repeatLane(channelId, soundId, isCurrent)).catch(
          warn("Could not repeat the track")
        );
        return;
      }
      track(advanceLane(channelId, isCurrent)).catch(
        warn("Could not play the next track")
      );
    }
  };

  /** Watches a Track or File lane's sound once it has one. */
  const watchLane = (channelId: string) => {
    const radio = laneOfChannel(channelId)?.radio;
    const { soundId } = getPlaybackChannelRuntime(channelId);
    if (
      !(soundId && isTrackRadio(radio)) ||
      laneWatches.get(channelId)?.soundId === soundId
    ) {
      return;
    }
    const watch: LaneWatch = { soundId };
    laneWatches.set(channelId, watch);
    ctx.channels.subscribeRuntime("node", channelId, soundId, {
      onAudioState: (state) => handleTrackState(channelId, watch, state),
    });
  };

  /**
   * A Track or File without a sound gets one before it plays, so its state
   * is watched from the start. A local file has none until then: restore
   * never prepares one.
   */
  const makeTrackSound = (channel: PlaybackChannelRecord) => {
    if (
      !(channel.radio && isTrackRadio(channel.radio)) ||
      getPlaybackChannelRuntime(channel.id).soundId
    ) {
      return;
    }
    laneWatches.delete(channel.id);
    const releaseFile = retainLocalFileUrl(channel.radio.streamUrl);
    try {
      createManagedSound("node", channel.id, channel.radio, undefined, ctx);
    } catch (error) {
      releaseFile();
      throw error;
    }
    fileSoundReleases.get(channel.id)?.();
    fileSoundReleases.set(channel.id, releaseFile);
    ctx.channels.setMuted("node", channel.id, channel.muted);
    watchLane(channel.id);
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

  /** Creates the lane's sound paused, as a session restore does. */
  const createLaneSound = (channelId: string) => {
    // A start still settling for the old sound must not clean this one.
    advanceChannelRevision(channelId);
    const channel = getPlaybackChannel("node", channelId);
    if (channel) {
      restoreManagedChannels("node", [channel], ctx);
      const releaseFile =
        channel.radio && getPlaybackChannelRuntime(channelId).soundId
          ? retainLocalFileUrl(channel.radio.streamUrl)
          : null;
      fileSoundReleases.get(channelId)?.();
      if (releaseFile) {
        fileSoundReleases.set(channelId, releaseFile);
      } else {
        fileSoundReleases.delete(channelId);
      }
      watchLane(channelId);
    }
  };

  const addLane = (laneId: string, channelId: string) => {
    const generation = bumpLane(laneId);
    const wasPlaying =
      (carriedLanes.get(laneId) ?? false) && !explicitStarts.has(laneId);
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
    // Never rejects: starts wait on it, and the UI starts without awaiting.
    const ready = settling
      .then(() => {
        if (
          epoch !== startEpoch ||
          laneGenerations.get(laneId) !== generation
        ) {
          return;
        }
        try {
          createLaneSound(channelId);
        } catch (error) {
          reportLaneError(channelId, error);
        }
      })
      .catch(warn("Could not re-add a lane"));
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
      releaseChannel(channelId);
      laneOutputs.release(channelId.slice(NODE_CHANNEL_PREFIX.length));
    }
  };

  const removeLane = (laneId: string, channelId: string) => {
    bumpLane(laneId);
    laneOutcomes.delete(laneId);
    advancingLanes.delete(channelId);
    // The plan already holds any replacement: the fading sound's end or
    // interruption must not act on it.
    laneWatches.delete(channelId);
    const runtime = getPlaybackChannelRuntime(channelId);
    carriedLanes.set(laneId, runtime.isPlaying || runtime.isLoading);
    cancelChannelStarts("remove", channelId);
    const startEpoch = epoch;
    // Never rejects: a re-add and any start wait on it.
    const removal = (settlingLanes.get(laneId) ?? Promise.resolve())
      .then(() => releaseLane(channelId, startEpoch))
      .catch(warn("Could not release a removed lane"));
    settlingLanes.set(laneId, removal);
    track(removal).finally(() => {
      if (settlingLanes.get(laneId) === removal) {
        settlingLanes.delete(laneId);
      }
    });
  };

  const replaceTree = async (laneId: string, tree: EffectConfig[]) => {
    const result = await effects.change(
      { channelId: laneChannelId(laneId), sessionId: "node" },
      { tree, type: "replace" }
    );
    recordOutcome(laneId, result.runtime);
    return result;
  };

  /** Per lane: layout swaps in flight, ducking or replacing its tree. */
  const pendingSwaps = new Map<string, number>();
  /** Lanes whose tree changed while a swap was in flight. */
  const staleSwaps = new Set<string>();

  const replaceLatestTree = (laneId: string) => {
    const lane = plan.lanes.get(laneId);
    if (lane) {
      track(replaceTree(lane.id, lane.effects)).catch(
        warn("Could not apply lane effects")
      );
    }
  };

  const endPendingSwap = (laneId: string) => {
    const count = (pendingSwaps.get(laneId) ?? 0) - 1;
    if (count > 0) {
      pendingSwaps.set(laneId, count);
      return;
    }
    pendingSwaps.delete(laneId);
    // A change the swap could not take, e.g. after its replace failed.
    if (staleSwaps.delete(laneId)) {
      replaceLatestTree(laneId);
    }
  };

  const changeLaneEffects = (laneId: string, tree: EffectConfig[]) => {
    // A swap in flight replaces with the lane's latest tree before its
    // duck lifts; applying this one now would change the layout audibly.
    if (pendingSwaps.has(laneId)) {
      staleSwaps.add(laneId);
      return;
    }
    track(replaceTree(laneId, tree)).catch(
      warn("Could not apply lane effects")
    );
  };

  /** Replaces a lane's tree, again while a commit changed it meanwhile. */
  const replaceUntilLatest = async (
    laneId: string
  ): Promise<ChannelEffectsResult | null> => {
    staleSwaps.delete(laneId);
    const lane = plan.lanes.get(laneId);
    if (!lane) {
      return null;
    }
    const result = await replaceTree(lane.id, lane.effects);
    return staleSwaps.has(laneId) ? replaceUntilLatest(laneId) : result;
  };

  /**
   * duckLane → replace → await outcome → unduckLane, on laneOut. The tree is
   * read when the lane is silent, so a commit during the duck is not undone
   * by this op's older tree, and a lane removed meanwhile is left alone. A
   * commit while the replace connects is replaced in turn, still ducked.
   */
  const swapLaneEffects = (laneId: string) => {
    pendingSwaps.set(laneId, (pendingSwaps.get(laneId) ?? 0) + 1);
    let pending = true;
    const endSwap = () => {
      if (pending) {
        pending = false;
        endPendingSwap(laneId);
      }
    };
    track(laneOutputs.swap(laneId, () => replaceUntilLatest(laneId)))
      .catch(warn("Could not swap lane effects"))
      .finally(endSwap);
  };

  /** Channels switch live on an open capture; a new one opens with them. */
  const applyLaneChannels = (
    channelId: string,
    selection: ChannelSelectionPlan
  ) => {
    const { soundId } = getPlaybackChannelRuntime(channelId);
    if (soundId && ctx.audio.getDeviceSource(soundId)) {
      ctx.audio.setDeviceChannelSelection(soundId, selection);
    }
  };

  /**
   * A removed or replaced lane keeps its old stream's level through its
   * fade-out: its cables go before its removeLane, and the new stream's
   * laneOut reads its level when it connects.
   */
  const refreshLane = (laneId: string | undefined, next: EnginePlan) => {
    if (
      laneId &&
      next.lanes.has(laneId) &&
      !removingLanes.has(laneId) &&
      !settlingLanes.has(laneId)
    ) {
      laneOutputs.refresh(laneId);
    }
  };

  const applyParam = (
    op: Extract<Op, { type: "setParam" }>,
    next: EnginePlan
  ) => {
    if (op.target === "edge") {
      refreshLane(next.edges.get(op.id)?.from.id, next);
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
        // On the sound's nodes, paused too, so a resume starts on it.
        applyLaneStrip(channelId);
        break;
      case "cueListen":
        // The tap lives on the sound's nodes, which exist once it plays.
        if (getPlaybackChannelRuntime(channelId).isPlaying) {
          syncCueTap(channelId);
        }
        break;
      case "transport":
        applyLaneTransport(channelId);
        break;
      case "channelSelection":
        applyLaneChannels(channelId, op.value);
        break;
      default: {
        const exhaustive: never = op;
        return exhaustive;
      }
    }
  };

  const applyOp = (op: Op, previous: EnginePlan, next: EnginePlan) => {
    switch (op.type) {
      case "addLane":
        addLane(op.lane.id, op.lane.channelId);
        break;
      case "removeLane":
        removeLane(op.laneId, laneChannelId(op.laneId));
        break;
      case "setLaneEffects":
        changeLaneEffects(op.laneId, op.effects);
        break;
      case "replaceLaneEffects":
        swapLaneEffects(op.laneId);
        break;
      // They bracket replaceLaneEffects, whose swap ducks and unducks.
      case "duckLane":
      case "unduckLane":
        break;
      case "setParam":
        applyParam(op, next);
        break;
      case "addEdge":
        refreshLane(op.edge.from.id, next);
        break;
      case "removeEdge":
        refreshLane(previous.edges.get(op.edgeId)?.from.id, next);
        break;
      case "rewireEdge":
        refreshLane(op.previous.from.id, next);
        refreshLane(op.edge.from.id, next);
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
  const applyOps = (
    ops: readonly Op[],
    previous: EnginePlan,
    next: EnginePlan,
    strict: boolean
  ) => {
    for (const op of ops) {
      if (strict) {
        applyOp(op, previous, next);
        continue;
      }
      try {
        applyOp(op, previous, next);
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
    if (!graph || isReadOnly()) {
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
    const previous = plan;
    const ops = diff(previous, next);
    plan = next;
    for (const op of ops) {
      if (op.type === "removeLane") {
        removingLanes.add(op.laneId);
      }
    }
    try {
      syncSinks(previous, next);
      applyOps(ops, previous, next, strict);
    } finally {
      // A carry is only "in place" within one batch; a later re-add of the
      // same Station must not resume it.
      carriedLanes.clear();
      removingLanes.clear();
      publishBadges();
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
   * turns its Monitor back off, unless a later Go live or stop took over.
   */
  const resetFailedMonitor = (
    nodeId: string,
    channelId: string,
    revision: number
  ) => {
    const runtime = getPlaybackChannelRuntime(channelId);
    const node = store.state.graph?.nodes.find((entry) => entry.id === nodeId);
    if (
      node?.type !== "deviceIn" ||
      !node.data.strip.monitor ||
      channelStartRevisions.get(channelId) !== revision + 1 ||
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
    const channelId = laneChannelId(nodeId);
    if (isDeviceChannel(channelId)) {
      // Monitor follows Go live, and no undo step toggles a mic.
      commitNodeGraph(
        (graph) => setSourceStrip(graph, nodeId, { monitor: playing }),
        store,
        "rebase"
      );
    }
    if (playing) {
      const revision = channelStartRevisions.get(channelId) ?? 0;
      await startChannel(channelId);
      resetFailedMonitor(nodeId, channelId, revision);
      return;
    }
    const cancelledStart = cancelChannelStarts("pause", channelId);
    const revision = cancelledStart
      ? (channelStartRevisions.get(channelId) ??
        advanceChannelRevision(channelId))
      : advanceChannelRevision(channelId);
    await setChannelPlaying(channelId, false, revision);
  };

  /**
   * Fades out and releases every `n:*` channel, then the lane outputs,
   * device sinks and badges, before the orphan check. Listening stops first.
   */
  const releaseAll = async () => {
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
      releaseChannel(channelId);
    }
    // The cue output a tap opened closes with the mode, as DJ's does.
    if (cueOpened) {
      cueOpened = false;
      try {
        cueOutput().releaseCue();
      } catch (error) {
        warn("Could not close the cue output")(error);
      }
    }
    advancingLanes.clear();
    laneOutputs.dispose();
    deviceSinks.dispose();
    publishSinkStatuses();
    plan = EMPTY_PLAN;
    laneOutcomes.clear();
    publishBadges();
    observedGraph = null;
    cleanupOrphanedSounds(soundIds, ctx, "node");
  };

  return {
    async activate() {
      const session = await getReadyManagedPlaybackSession("node");
      epoch += 1;
      plan = EMPTY_PLAN;
      settlingLanes.clear();
      carriedLanes.clear();
      laneOutcomes.clear();
      laneWatches.clear();
      advancingLanes.clear();
      stopListening();
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
      active = true;
      subscription = store.subscribe(onStoreChange);
      if (migration.status !== "ok") {
        return;
      }
      try {
        reconcile(true);
      } catch (error) {
        // The manager reports this mode inactive: release the lanes made
        // before the failing one.
        stopListening();
        await releaseAll();
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
      await releaseAll();
    },
    flush: applyPendingCommit,
    jumpToCue(nodeId) {
      const lane = plan.lanes.get(nodeId);
      const node = findSource(store.state.graph, nodeId);
      const cue = node && "cue" in node.data.strip ? node.data.strip.cue : null;
      const { soundId } = getPlaybackChannelRuntime(laneChannelId(nodeId));
      if (lane?.transport && soundId && cue !== null) {
        seekSound(ctx.audioEngine.playback, soundId, cue);
      }
    },
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
      // Streams only: a mic goes live from its own Go live, never in bulk.
      const channels = (getPlaybackSession("node")?.channels ?? []).filter(
        (channel) =>
          !(
            getPlaybackChannelRuntime(channel.id).isPlaying ||
            isDeviceChannel(channel.id)
          )
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
    async playTrack(nodeId, streamUrl) {
      const lane = plan.lanes.get(nodeId);
      const source = findSource(store.state.graph, nodeId);
      if (!(active && lane && isRadioSourceNode(source))) {
        return;
      }
      pendingChannelStarts.cancel(lane.channelId);
      advanceChannelRevision(lane.channelId);
      const startEpoch = epoch;
      const hasSource = (expectedRadio: Radio) => {
        const current = findSource(store.state.graph, nodeId);
        return (
          active &&
          epoch === startEpoch &&
          isRadioSourceNode(current) &&
          current.type === source.type &&
          current.data.radio === expectedRadio
        );
      };
      const pending = pendingChannelStarts.begin(lane.channelId, () =>
        hasSource(lane.radio as Radio)
      );
      const { isCurrent } = pending;
      let radio: Radio | null;
      try {
        radio = await radioOnTrack(
          lane.radio as Radio,
          streamUrl,
          resolveStream
        );
      } catch (error) {
        if (isCurrent()) {
          reportLaneFailure(lane.channelId, "Couldn't load this track", error);
        }
        return;
      } finally {
        // Its own source replacement cancels pending starts during the fade.
        pending.release();
      }
      if (!isCurrent()) {
        return;
      }
      if (radio) {
        await playLaneTrack(nodeId, radio, () => hasSource(radio));
      } else {
        reportLaneFailure(lane.channelId, "Couldn't load this track");
      }
    },
    retryOutputDevice(nodeId) {
      applyPendingCommit();
      if (active && plan.sinks.get(nodeId)?.type === "deviceOut") {
        deviceSinks.retry(nodeId);
      }
    },
    seek(nodeId, position) {
      const lane = plan.lanes.get(nodeId);
      const { soundId } = getPlaybackChannelRuntime(laneChannelId(nodeId));
      if (lane?.transport && soundId) {
        seekSound(ctx.audioEngine.playback, soundId, position);
      }
    },
    setCue(nodeId) {
      const { soundId } = getPlaybackChannelRuntime(laneChannelId(nodeId));
      const position = soundId
        ? ctx.audio.getTrackProgress(soundId)?.position
        : undefined;
      if (
        !plan.lanes.get(nodeId)?.transport ||
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

export function getNodePlayback({
  backendBadges = nodeBackendBadges,
  ctx = getDefaultPlaybackActionContext(),
  cueOutput = getOutputRouting,
  deviceSinks = createNodeDeviceSinks,
  effects = channelEffects,
  fadeOutDurationMs = DEFAULT_FADE_OUT_DURATION_MS,
  fadeOutSound = fadeOut,
  getEnv = detectNodePlaybackEnv,
  laneOutputs = createNodeLaneOutputs,
  resolveStream = resolveDjPlatformStreamUrl,
  sinkStatuses = nodeSinkStatuses,
  store = nodeStore,
}: GetNodePlaybackOptions = {}): NodePlayback {
  const existing = instances.get(ctx);
  if (existing) {
    return existing;
  }
  const playback = createNodePlayback(ctx, {
    backendBadges,
    cueOutput,
    deviceSinks,
    effects,
    fadeOutDurationMs,
    fadeOutSound,
    getEnv,
    laneOutputs,
    resolveStream,
    sinkStatuses,
    store,
  });
  instances.set(ctx, playback);
  return playback;
}
