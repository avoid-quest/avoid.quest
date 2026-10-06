import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { makeSentryOptions } from "@avoid.quest/error";
// biome-ignore lint/performance/noNamespaceImport: observe the production reporter
import * as Sentry from "@sentry/core";
import { close, flush, init } from "@sentry/tanstackstart-react";
import { Store } from "@tanstack/react-store";
import { toast } from "sonner";
import {
  type AudioEngineFacade,
  AudioManager,
  type AudioState,
  type Radio,
} from "@/lib/audio";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import { createPlaybackSourceCallbacks } from "@/lib/audio/manager/audio-manager-source-callbacks";
import type {
  MainOutputConnect,
  SoundInstance,
  SoundOutputConnector,
} from "@/lib/audio/manager/audio-manager-types";
import {
  capturedStream,
  createDeviceCaptureHarness,
} from "@/lib/audio/manager/device-capture-test-harness";
import {
  createFakeFader,
  FakeAudioContext,
  type FakeGainNode,
} from "@/lib/audio/routing/fake-audio-nodes";
import { createNodeDeviceSinks } from "@/lib/audio/routing/node-device-sinks";
import {
  createNodeLaneOutputs,
  LANE_DROP_MS,
  LANE_DUCK_MS,
  LANE_LEVEL_TIME_CONSTANT_S,
} from "@/lib/audio/routing/node-lane-outputs";
import { subscribeChannelRuntime } from "@/lib/channel-state-manager";
import { writeLegacyRecord } from "@/lib/collections/migrations/legacy-records";
import {
  getPlaybackChannel,
  getPlaybackSession,
  initializePlaybackSessions,
  playbackSessionsCollection,
  stopLegacyMultipleListeners,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { getSettings, settingsCollection } from "@/lib/collections/settings";
import type { PlatformStreamResolution } from "@/lib/dj-platform-stream-port";
import { resolveDjPlatformStreamUrl } from "@/lib/dj-platform-stream-port";
import { setBandCount } from "@/lib/node-graph/branches";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import { compile } from "@/lib/node-graph/compile";
import {
  removeEdges,
  setEffectParams,
  setSourceRadio,
  setSourceStrip,
} from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  createNodeStore,
  loadNodeGraph,
  type NodeStore,
  undoNodeGraph,
} from "@/lib/node-graph/node-store";
import { diff } from "@/lib/node-graph/reconcile";
import {
  type NodeGraph,
  type NodeGraphInput,
  nodeGraphSchema,
} from "@/lib/node-graph/schema";
import { deriveNodeChannels } from "@/lib/node-graph/session-channels";
import {
  forgetLocalFileUrls,
  keepLocalFileUrl,
  localFileRadio,
  releaseUnusedLocalFileUrls,
} from "@/lib/node-graph/sources";
import { buildNodeSessionFromGraph } from "@/lib/node-graph/template-sessions";
import { buildNodeGraphFromTemplate } from "@/lib/node-graph/templates";
import type { Profile } from "@/lib/node-graph/validate";
import {
  getPlaybackChannelRuntime,
  resetAllPlaybackRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import {
  type ChannelEffectsResult,
  createChannelEffects,
  type DesiredEffectsState,
  type EffectsRuntimeOutcome,
} from "./channel-effects";
import {
  type GetNodePlaybackOptions,
  getNodePlayback,
  laneBackendBadge,
  type NodeBackendBadgeStore,
  type NodeBackendBadges,
  type NodePlayback,
  type NodeSinkStatuses,
} from "./node-playback";
import type { OutputRouting, OutputRoutingSnapshot } from "./output-routing";
import type { PlaybackActionContext } from "./playback-action-context";
import { capturePlaybackActionError } from "./playback-action-errors";

type NodeInput = NodeGraphInput["nodes"][number];

function radio(id: string): Radio {
  return {
    id,
    name: `Station ${id}`,
    streamUrl: `https://radio.example/${id}.mp3`,
  };
}

function station(
  id: string,
  data: { volume?: number; muted?: boolean; radio?: Radio | null } = {}
): NodeInput {
  return {
    data: { radio: radio(id), ...data },
    id,
    position: { x: 0, y: 0 },
    type: "station",
  };
}

const speakers: NodeInput = {
  data: { muted: false },
  id: "speakers",
  position: { x: 480, y: 0 },
  type: "speakers",
};

function reverb(id: string, overrides: Partial<EffectConfig> = {}): NodeInput {
  return {
    data: {
      effect: {
        ...createNodeEffectConfig("cheapReverb", id),
        enabled: true,
        ...overrides,
      },
    },
    id,
    position: { x: 240, y: 0 },
    type: "cheapReverb",
  } as NodeInput;
}

function cable(source: string, target: string) {
  return {
    id: `${source}->${target}`,
    source,
    sourceHandle: "out:audio:main",
    target,
    targetHandle: "in:audio:main",
  };
}

/** Each station wired straight to Speakers. */
function patch(stations: NodeInput[]): NodeGraph {
  return nodeGraphSchema.parse({
    edges: stations.map((node) => cable(node.id, "speakers")),
    nodes: [...stations, speakers],
    version: 2,
  });
}

function channelOf(nodeId: string): string {
  return `n:${nodeId}`;
}

function soundOf(nodeId: string): string {
  return `node:n:${nodeId}`;
}

async function resetCollections(): Promise<void> {
  await Promise.all([
    playbackSessionsCollection.stateWhenReady(),
    settingsCollection.stateWhenReady(),
  ]);
  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
  for (const settingsId of Array.from(settingsCollection.state.keys())) {
    settingsCollection.delete(settingsId);
  }
}

function insertSettings(): void {
  settingsCollection.insert({
    audio: {
      cueOutputId: null,
      delay: { cueDelayMs: 0, mainDelayMs: 0 },
      mainOutputId: "default",
    },
    id: "app-settings",
    player: { mode: "node", restoreStateOnLoad: true },
  });
}

function insertNodeSession(
  graph: NodeGraph = patch([]),
  masterVolume = 0.8
): void {
  playbackSessionsCollection.insert({
    activeChannelId: null,
    channels: [],
    crossfadePosition: 0.5,
    graph,
    headphoneVolume: 1,
    id: "node",
    masterVolume,
  });
}

function createTestContext(): PlaybackActionContext {
  return {
    audio: {
      cleanupSound: mock((_soundId: string) => undefined),
      getEffectsRuntimeOutcome: mock(
        (_soundId: string): EffectsRuntimeOutcome => ({
          backend: null,
          ready: false,
          status: "inactive",
        })
      ),
      getPreFaderNode: mock((soundId: string) => ({ soundId })),
      getTrackProgress: mock((_soundId: string) => null),
      hasSound: mock((_soundId: string) => false),
      pauseSound: mock((_soundId: string) => undefined),
      playSound: mock(async (_soundId: string, _volume: number) => undefined),
      setGlobalVolume: mock((_volume: number) => undefined),
      setKeyLock: mock((_soundId: string, _keyLock: boolean) => undefined),
      setMainDelay: mock((_delayMs: number) => undefined),
      setPan: mock((_soundId: string, _pan: number) => undefined),
      setPlaybackRate: mock((_soundId: string, _rate: number) => undefined),
      setSoundOutputConnector: mock(
        (_soundId: string, _connect: SoundOutputConnector | null) => undefined
      ),
      updateFilter: mock((_soundId: string, _config: unknown) => undefined),
    } as unknown as AudioManager,
    audioEngine: {
      playback: {
        pause: mock((_soundId: string) => undefined),
        play: mock(async (_soundId: string, _volume?: number) => undefined),
        refreshStreamUrl: mock(
          async (_soundId: string, _newUrl: string, _seek?: number) => undefined
        ),
        seek: mock((_soundId: string, _position: number) => undefined),
      },
      volume: {
        setChannelVolume: mock(
          (_soundId: string, _volume: number) => undefined
        ),
        setMasterVolume: mock((_volume: number) => undefined),
      },
    } satisfies AudioEngineFacade,
    channels: {
      activate: mock(
        (
          _sessionId,
          channelId,
          _radio,
          optionsOrSoundId?: string | { soundId?: string }
        ) => {
          const soundId =
            typeof optionsOrSoundId === "string"
              ? optionsOrSoundId
              : (optionsOrSoundId?.soundId ?? `node:${channelId}`);
          setPlaybackChannelRuntime(channelId, () => ({ soundId }));
          return soundId;
        }
      ),
      deactivate: mock((channelId: string) => {
        resetPlaybackChannelRuntime(channelId);
      }),
      deactivateAll: mock(() => undefined),
      getOutputMode: mock((_channelId: string) => "audio-graph" as const),
      setMuted: mock((sessionId, channelId, muted) => {
        updatePlaybackChannel(sessionId, channelId, (draft) => {
          draft.muted = muted;
        });
      }),
      setPan: mock((_sessionId, _channelId, _pan) => undefined),
      setSpeed: mock((_sessionId, _channelId, _speed) => undefined),
      setVolume: mock((sessionId, channelId, volume) => {
        updatePlaybackChannel(sessionId, channelId, (draft) => {
          draft.volume = volume;
        });
      }),
      subscribeRuntime: mock((_sessionId, _channelId, _soundId) => undefined),
    },
    getMainOutputRouter: () => null,
    lifecycle: { mainOutputSettingsApplied: true },
    reportError: mock(() => undefined),
    resetAudioManager: mock(() => undefined),
    resumeAudioContext: mock(async () => undefined),
  };
}

type Harness = {
  context: PlaybackActionContext;
  effectsChange: ReturnType<typeof mock>;
  fadeOutSound: ReturnType<typeof mock>;
  /** What hears of another tab's session writes while Node is active. */
  otherTabListeners: Set<() => void>;
  playback: NodePlayback;
  store: NodeStore;
};

const harnessPlaybacks = new Set<NodePlayback>();

function createHarness(
  options: {
    backendBadges?: NodeBackendBadgeStore;
    context?: PlaybackActionContext;
    crossOriginIsolated?: boolean;
    effects?: GetNodePlaybackOptions["effects"];
    effectsOutcome?: () => EffectsRuntimeOutcome;
    fadeOutSound?: (soundId: string, durationMs: number) => Promise<void>;
    laneOutputs?: GetNodePlaybackOptions["laneOutputs"];
    deviceSinks?: GetNodePlaybackOptions["deviceSinks"];
    sinkStatuses?: GetNodePlaybackOptions["sinkStatuses"];
    resolveStream?: GetNodePlaybackOptions["resolveStream"];
    profile?: Profile;
  } = {}
): Harness {
  const context = options.context ?? createTestContext();
  const store = createNodeStore();
  const { effectsOutcome } = options;
  const effectsChange = mock(
    async () =>
      (effectsOutcome
        ? { runtime: effectsOutcome() }
        : {}) as ChannelEffectsResult
  );
  const fadeOutSound = mock(
    options.fadeOutSound ?? (async (_soundId: string) => undefined)
  );
  const otherTabListeners = new Set<() => void>();
  const playback = getNodePlayback({
    backendBadges: options.backendBadges ?? new Store<NodeBackendBadges>({}),
    ctx: context,
    effects: options.effects ?? { change: effectsChange },
    fadeOutSound,
    getEnv: () => ({
      crossOriginIsolated: options.crossOriginIsolated ?? false,
      profile: options.profile ?? "desktop",
    }),
    laneOutputs: options.laneOutputs,
    otherTabWrites: (listener) => {
      otherTabListeners.add(listener);
      return () => otherTabListeners.delete(listener);
    },
    ...(options.deviceSinks ? { deviceSinks: options.deviceSinks } : {}),
    ...(options.resolveStream ? { resolveStream: options.resolveStream } : {}),
    sinkStatuses: options.sinkStatuses ?? new Store<NodeSinkStatuses>({}),
    store,
  });
  harnessPlaybacks.add(playback);
  return {
    context,
    effectsChange,
    fadeOutSound,
    otherTabListeners,
    playback,
    store,
  };
}

/**
 * Stores `graph`, with its channels, as another tab's write reaches this
 * one: the collection syncs the stored JSON, then the tab hears of it.
 * `beforeTakenIn` runs once the tab heard, before it takes the patch in.
 * Returns the stored session as the other tab wrote it.
 */
async function writeFromOtherTab(
  harness: Harness,
  graph: NodeGraph,
  beforeTakenIn?: () => void
): Promise<ReturnType<typeof getPlaybackSession>> {
  const session = getPlaybackSession("node");
  if (!session) {
    throw new Error("No node session");
  }
  writeLegacyRecord(
    playbackSessionsCollection,
    JSON.parse(
      JSON.stringify({
        ...session,
        channels: deriveNodeChannels(
          compile(graph, { crossOriginIsolated: false }),
          session.channels
        ),
        graph,
      })
    )
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const written = getPlaybackSession("node");
  for (const listener of harness.otherTabListeners) {
    listener();
  }
  beforeTakenIn?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.playback.whenSettled();
  return written;
}

/** Commits an edit and waits for its ops, fades included. */
async function commit(
  { playback, store }: Harness,
  update: (graph: NodeGraph) => NodeGraph
): Promise<void> {
  commitNodeGraph(update, store);
  await playback.whenSettled();
}

function withStation(
  nodeId: string,
  data: { volume?: number; muted?: boolean; radio?: Radio | null }
) {
  return (graph: NodeGraph): NodeGraph => ({
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === nodeId && node.type === "station"
        ? { ...node, data: { ...node.data, ...data } }
        : node
    ),
  });
}

function stationData(store: NodeStore, nodeId: string) {
  const node = store.state.graph?.nodes.find((entry) => entry.id === nodeId);
  return node?.type === "station" ? node.data : undefined;
}

/** playSound mock whose starts wait for a release each. */
function heldStarts(context: PlaybackActionContext) {
  const releases: Array<() => void> = [];
  const started: string[] = [];
  context.audio.playSound = mock(
    (soundId: string) =>
      new Promise<void>((resolve) => {
        started.push(soundId);
        releases.push(() => {
          setPlaybackChannelRuntime(soundId.slice("node:".length), () => ({
            isPlaying: true,
          }));
          resolve();
        });
      })
  );
  return { releases, started };
}

/** playSound mock that starts each lane at once. */
function instantStarts(context: PlaybackActionContext): void {
  context.audio.playSound = mock((soundId: string) => {
    setPlaybackChannelRuntime(soundId.slice("node:".length), () => ({
      isPlaying: true,
    }));
    return Promise.resolve();
  });
}

beforeEach(async () => {
  await resetCollections();
  resetAllPlaybackRuntime();
  insertSettings();
});

afterEach(async () => {
  for (const playback of harnessPlaybacks) {
    playback.flush();
  }
  harnessPlaybacks.clear();
  await Promise.resolve();
  stopLegacyMultipleListeners();
  await resetCollections();
  resetAllPlaybackRuntime();
});

describe("Node Playback", () => {
  test("activation builds each lane paused on the audio graph and caches its channel", async () => {
    insertNodeSession(
      patch([station("a"), station("b", { muted: true, volume: 0.35 })])
    );
    const harness = createHarness();

    expect(getNodePlayback({ ctx: harness.context })).toBe(harness.playback);
    await harness.playback.activate();

    expect(harness.context.channels.activate).toHaveBeenCalledWith(
      "node",
      channelOf("a"),
      expect.objectContaining({ id: "a" }),
      soundOf("a")
    );
    expect(harness.context.audio.playSound).not.toHaveBeenCalled();
    expect(harness.context.audio.setGlobalVolume).toHaveBeenCalledWith(0.8);
    expect(getPlaybackSession("node")?.channels).toEqual([
      expect.objectContaining({
        id: channelOf("a"),
        muted: false,
        order: 0,
        role: "node",
        volume: 1,
      }),
      expect.objectContaining({
        id: channelOf("b"),
        muted: true,
        order: 1,
        role: "node",
        volume: 0.35,
      }),
    ]);
  });

  test("restore disabled retains the authored patch and activates its lanes paused", async () => {
    const graph = patch([station("authored", { volume: 0.42 })]);
    insertNodeSession(graph, 0.23);
    settingsCollection.update("app-settings", (draft) => {
      draft.player.restoreStateOnLoad = false;
    });
    const harness = createHarness();

    await initializePlaybackSessions();
    await harness.playback.activate();

    expect(harness.store.state.graph).toEqual(graph);
    expect(harness.context.channels.activate).toHaveBeenCalledWith(
      "node",
      channelOf("authored"),
      expect.objectContaining({ id: "authored" }),
      soundOf("authored")
    );
    expect(harness.context.audio.playSound).not.toHaveBeenCalled();
    expect(harness.context.audioEngine.playback.play).not.toHaveBeenCalled();
    expect(getPlaybackChannelRuntime(channelOf("authored")).isPlaying).toBe(
      false
    );
    expect(harness.context.audio.setGlobalVolume).toHaveBeenCalledWith(0.23);
  });

  test("a node session without a graph loads the Starter patch", async () => {
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "node",
      masterVolume: 0.8,
    });
    const harness = createHarness();

    await harness.playback.activate();

    expect(harness.store.state.graph).toEqual(
      buildNodeGraphFromTemplate("starter")
    );
    expect(harness.context.channels.activate).not.toHaveBeenCalled();
  });

  test("a future patch cannot compile, edit, or play its cached channels", async () => {
    const session = buildNodeSessionFromGraph(patch([station("a")]));
    const graph = { ...session.graph, futureField: "keep me", version: 3 };
    writeLegacyRecord(playbackSessionsCollection, { ...session, graph });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const harness = createHarness();

    await harness.playback.activate();

    expect(harness.store.state.graph).toBeNull();
    expect(harness.store.state.readOnlyVersion).toBe(3);
    expect(
      commitNodeGraph(
        (current) => ({
          ...current,
          viewport: { ...current.viewport, x: 123 },
        }),
        harness.store,
        "snapshot"
      )
    ).toBe(false);
    await harness.playback.playAll();
    await harness.playback.setPlaying("a", true);
    harness.playback.setVolume("a", 0.3);
    harness.playback.setMasterVolume(0.4);
    harness.playback.toggleMasterMute();
    harness.playback.flush();
    await harness.playback.whenSettled();

    expect(harness.context.channels.activate).not.toHaveBeenCalled();
    expect(harness.context.audio.playSound).not.toHaveBeenCalled();
    expect(harness.context.audio.setGlobalVolume).not.toHaveBeenCalled();
    expect(JSON.stringify(getPlaybackSession("node")?.graph)).toBe(
      JSON.stringify(graph)
    );
    expect(getPlaybackSession("node")?.masterVolume).toBe(session.masterVolume);
    await harness.playback.deactivate();
  });

  test("an empty Station slot has no lane", async () => {
    insertNodeSession(patch([station("a"), station("empty", { radio: null })]));
    const harness = createHarness();

    await harness.playback.activate();

    expect(
      getPlaybackSession("node")?.channels.map((channel) => channel.id)
    ).toEqual([channelOf("a")]);
    expect(harness.context.channels.activate).toHaveBeenCalledTimes(1);
  });

  test("a commit that only changes a Station volume keeps its sound", async () => {
    insertNodeSession(patch([station("a"), station("b")]));
    const harness = createHarness();
    await harness.playback.activate();
    setPlaybackChannelRuntime(channelOf("a"), () => ({ isPlaying: true }));

    await commit(harness, withStation("a", { volume: 0.4 }));

    expect(harness.context.channels.setVolume).toHaveBeenCalledTimes(1);
    expect(harness.context.channels.setVolume).toHaveBeenCalledWith(
      "node",
      channelOf("a"),
      0.4
    );
    expect(harness.context.channels.activate).toHaveBeenCalledTimes(2);
    expect(harness.context.channels.deactivate).not.toHaveBeenCalled();
    expect(harness.context.audio.cleanupSound).not.toHaveBeenCalled();
    expect(harness.fadeOutSound).not.toHaveBeenCalled();
    expect(getPlaybackChannelRuntime(channelOf("a"))).toMatchObject({
      isPlaying: true,
      soundId: soundOf("a"),
    });
    expect(getPlaybackChannel("node", channelOf("a"))?.volume).toBe(0.4);
  });

  test("a commit that only changes an FX param replaces the lane's tree in place", async () => {
    insertNodeSession(
      nodeGraphSchema.parse({
        edges: [cable("a", "verb"), cable("verb", "speakers")],
        nodes: [station("a"), reverb("verb"), speakers],
        version: 2,
      })
    );
    const harness = createHarness();
    await harness.playback.activate();

    await commit(harness, (graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === "verb" && node.type === "cheapReverb"
          ? {
              ...node,
              data: { effect: { ...node.data.effect, dryWet: 0.25 } },
            }
          : node
      ),
    }));

    expect(harness.effectsChange).toHaveBeenCalledTimes(1);
    expect(harness.effectsChange).toHaveBeenCalledWith(
      { channelId: channelOf("a"), sessionId: "node" },
      {
        tree: [expect.objectContaining({ dryWet: 0.25, id: "verb" })],
        type: "replace",
      }
    );
    expect(harness.context.channels.activate).toHaveBeenCalledTimes(1);
    expect(harness.context.channels.deactivate).not.toHaveBeenCalled();
    expect(getPlaybackChannel("node", channelOf("a"))?.effects).toEqual([
      expect.objectContaining({ dryWet: 0.25, id: "verb" }),
    ]);
  });

  test("commits in one tick apply as one batch", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    await harness.playback.activate();

    commitNodeGraph(withStation("a", { volume: 0.5 }), harness.store);
    commitNodeGraph(withStation("a", { volume: 0.6 }), harness.store);
    await harness.playback.whenSettled();

    expect(harness.context.channels.setVolume).toHaveBeenCalledTimes(1);
    expect(harness.context.channels.setVolume).toHaveBeenCalledWith(
      "node",
      channelOf("a"),
      0.6
    );
  });

  test("flush applies a pending commit, so a start right after it plays in the same task", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();

    commitNodeGraph(() => patch([station("a"), station("b")]), harness.store);
    harness.playback.flush();
    const started = harness.playback.setPlaying("b", true);

    // No await yet: the play call ran inside the caller's gesture.
    expect(harness.context.audio.playSound).toHaveBeenCalledWith(
      soundOf("b"),
      expect.any(Number)
    );
    await started;
    await harness.playback.whenSettled();
    expect(harness.context.channels.activate).toHaveBeenCalledTimes(2);
  });

  test("a new Station gets a paused lane", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    await harness.playback.activate();

    await commit(harness, () => patch([station("a"), station("b")]));

    expect(harness.context.channels.activate).toHaveBeenLastCalledWith(
      "node",
      channelOf("b"),
      expect.objectContaining({ id: "b" }),
      soundOf("b")
    );
    expect(harness.context.audio.playSound).not.toHaveBeenCalled();
    expect(
      getPlaybackSession("node")?.graph?.nodes.map((node) => node.id)
    ).toEqual(["a", "b", "speakers"]);
  });

  test("a removed Station fades out for 150 ms before its channel is released", async () => {
    insertNodeSession(patch([station("a"), station("b")]));
    const fade = Promise.withResolvers<void>();
    const harness = createHarness({ fadeOutSound: () => fade.promise });
    await harness.playback.activate();

    commitNodeGraph(() => patch([station("b")]), harness.store);
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.fadeOutSound).toHaveBeenCalledWith(soundOf("a"), 150, true);
    expect(harness.context.channels.deactivate).not.toHaveBeenCalled();
    expect(
      getPlaybackSession("node")?.channels.map((channel) => channel.id)
    ).toEqual([channelOf("b")]);

    fade.resolve();
    await harness.playback.whenSettled();

    expect(harness.context.channels.deactivate).toHaveBeenCalledWith(
      channelOf("a")
    );
    expect(getPlaybackChannelRuntime(channelOf("a")).soundId).toBeNull();
    expect(getPlaybackChannelRuntime(channelOf("b")).soundId).toBe(
      soundOf("b")
    );
  });

  test("a playing Station whose stream changes in place resumes on the new one", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    await harness.playback.activate();
    setPlaybackChannelRuntime(channelOf("a"), () => ({ isPlaying: true }));
    const saved = { ...radio("a"), id: "saved-a" };

    await commit(harness, withStation("a", { radio: saved }));

    expect(harness.fadeOutSound).toHaveBeenCalledWith(soundOf("a"), 150, true);
    expect(harness.context.channels.deactivate).toHaveBeenCalledWith(
      channelOf("a")
    );
    expect(harness.context.channels.activate).toHaveBeenLastCalledWith(
      "node",
      channelOf("a"),
      saved,
      soundOf("a")
    );
    expect(harness.context.audio.playSound).toHaveBeenCalledWith(
      soundOf("a"),
      1
    );
  });

  test("a paused Station whose stream changes in place stays paused", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    await harness.playback.activate();

    await commit(
      harness,
      withStation("a", { radio: { ...radio("a"), id: "saved-a" } })
    );

    expect(harness.context.channels.activate).toHaveBeenCalledTimes(2);
    expect(harness.context.audio.playSound).not.toHaveBeenCalled();
  });

  test("a failed activation releases the lanes it made before failing", async () => {
    insertNodeSession(patch([station("a"), station("b")]));
    const harness = createHarness();
    const { activate } = harness.context.channels;
    harness.context.channels.activate = mock(
      (...args: Parameters<typeof activate>) => {
        if (args[1] === channelOf("b")) {
          throw new Error("no sound");
        }
        return activate(...args);
      }
    );

    await expect(harness.playback.activate()).rejects.toThrow("no sound");

    expect(harness.context.channels.deactivate).toHaveBeenCalledWith(
      channelOf("a")
    );
    expect(getPlaybackChannelRuntime(channelOf("a")).soundId).toBeNull();
  });

  test("keeps a commit queued in the same tick as deactivation", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    await harness.playback.activate();

    commitNodeGraph(() => patch([station("a"), station("b")]), harness.store);
    await harness.playback.deactivate();

    expect(
      getPlaybackSession("node")?.graph?.nodes.map((node) => node.id)
    ).toEqual(["a", "b", "speakers"]);
    expect(
      getPlaybackSession("node")?.channels.map((channel) => channel.id)
    ).toEqual([channelOf("a"), channelOf("b")]);
  });

  test("ignores store commits once deactivated", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    await harness.playback.activate();
    await harness.playback.deactivate();

    await commit(harness, () => patch([station("a"), station("b")]));

    expect(harness.context.channels.activate).toHaveBeenCalledTimes(1);
    expect(
      getPlaybackSession("node")?.channels.map((channel) => channel.id)
    ).toEqual([channelOf("a")]);
  });
});

describe("Node Playback volume and mute", () => {
  test("preserves Station and master volume across mute toggles", async () => {
    insertNodeSession(patch([station("a", { volume: 0.35 })]));
    const harness = createHarness();
    await harness.playback.activate();

    harness.playback.toggleMute("a");
    await harness.playback.whenSettled();
    expect(getPlaybackChannel("node", channelOf("a"))).toMatchObject({
      muted: true,
      volume: 0.35,
    });
    expect(stationData(harness.store, "a")).toMatchObject({
      muted: true,
      volume: 0.35,
    });
    harness.playback.toggleMute("a");
    await harness.playback.whenSettled();
    expect(getPlaybackChannel("node", channelOf("a"))).toMatchObject({
      muted: false,
      volume: 0.35,
    });

    harness.playback.toggleMasterMute();
    expect(getPlaybackSession("node")?.masterVolume).toBe(0);
    harness.playback.toggleMasterMute();
    expect(getPlaybackSession("node")?.masterVolume).toBe(0.8);
  });

  test("master volume is heard while settings still hold the legacy Multiple mode", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    await harness.playback.activate();
    // A legacy record that failed its rewrite stays "multiple"; Node runs.
    const settings = getSettings() as unknown as {
      player: { mode: string };
    };
    settings.player.mode = "multiple";

    harness.playback.setMasterVolume(0.3);

    expect(harness.context.audio.setGlobalVolume).toHaveBeenLastCalledWith(0.3);
  });

  test("unmuting a zero volume restores the latest volume a commit set", async () => {
    insertNodeSession(patch([station("a", { volume: 0.35 })]));
    const harness = createHarness();
    await harness.playback.activate();

    await commit(harness, withStation("a", { volume: 0.7 }));
    harness.playback.setVolume("a", 0);
    await harness.playback.whenSettled();
    harness.playback.toggleMute("a");
    await harness.playback.whenSettled();

    expect(stationData(harness.store, "a")?.volume).toBe(0.7);
  });

  test("restores a positive Station volume when persisted state starts at zero", async () => {
    insertNodeSession(patch([station("a", { volume: 0 })]));
    const harness = createHarness();
    await harness.playback.activate();

    harness.playback.toggleMute("a");
    await harness.playback.whenSettled();

    expect(getPlaybackChannel("node", channelOf("a"))?.volume).toBe(1);
  });

  test("unmuting a persisted muted zero-volume Station restores volume", async () => {
    insertNodeSession(patch([station("a", { muted: true, volume: 0 })]));
    const harness = createHarness();
    await harness.playback.activate();

    harness.playback.toggleMute("a");
    await harness.playback.whenSettled();

    expect(getPlaybackChannel("node", channelOf("a"))).toMatchObject({
      muted: false,
      volume: 1,
    });
  });

  test("unmuting re-applies the persisted Station volume", async () => {
    insertNodeSession(patch([station("a", { muted: true, volume: 0.35 })]));
    const harness = createHarness();
    await harness.playback.activate();

    harness.playback.toggleMute("a");
    await harness.playback.whenSettled();

    expect(getPlaybackChannel("node", channelOf("a"))).toMatchObject({
      muted: false,
      volume: 0.35,
    });
    expect(harness.context.channels.setMuted).toHaveBeenLastCalledWith(
      "node",
      channelOf("a"),
      false
    );
    expect(harness.context.channels.setVolume).toHaveBeenLastCalledWith(
      "node",
      channelOf("a"),
      0.35
    );
  });

  test("raising a Station volume clears its mute", async () => {
    insertNodeSession(patch([station("a", { muted: true, volume: 0.35 })]));
    const harness = createHarness();
    await harness.playback.activate();

    harness.playback.setVolume("a", 0.7);
    await harness.playback.whenSettled();

    expect(getPlaybackChannel("node", channelOf("a"))).toMatchObject({
      muted: false,
      volume: 0.7,
    });
    expect(harness.context.channels.setMuted).toHaveBeenLastCalledWith(
      "node",
      channelOf("a"),
      false
    );
  });

  test("a volume change on a muted Station leaves its sound muted", async () => {
    insertNodeSession(patch([station("a", { muted: true, volume: 0.35 })]));
    const harness = createHarness();
    await harness.playback.activate();

    harness.playback.setVolume("a", 0);
    await harness.playback.whenSettled();

    expect(harness.context.channels.setVolume).not.toHaveBeenCalled();
    expect(getPlaybackChannel("node", channelOf("a"))).toMatchObject({
      muted: true,
      volume: 0,
    });
  });

  test("restores a positive master volume when persisted state starts muted", async () => {
    insertNodeSession(patch([]), 0);
    const harness = createHarness();

    await harness.playback.activate();
    harness.playback.toggleMasterMute();

    expect(getPlaybackSession("node")?.masterVolume).toBe(1);
  });

  test("activation reapplies persisted Station mute", async () => {
    insertNodeSession(patch([station("a", { muted: true })]));
    const harness = createHarness();

    await harness.playback.activate();

    expect(harness.context.channels.setMuted).toHaveBeenCalledWith(
      "node",
      channelOf("a"),
      true
    );
  });
});

describe("Node Playback starts", () => {
  test("pauses an existing lane even when its Station is invalid", async () => {
    const invalid = {
      ...radio("invalid"),
      platformMetadata: {
        itemType: "video",
        platform: "youtube",
        url: "https://youtube.example/watch?v=invalid",
      },
    } as Radio;
    insertNodeSession(patch([station("a", { radio: invalid })]));
    const harness = createHarness();
    await harness.playback.activate();
    setPlaybackChannelRuntime(channelOf("a"), () => ({
      isPlaying: true,
      soundId: soundOf("a"),
    }));

    await harness.playback.setPlaying("a", false);

    expect(harness.context.audio.pauseSound).toHaveBeenCalledWith(soundOf("a"));
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test("bounds play-all network pressure to three lanes", async () => {
    insertNodeSession(
      patch(["1", "2", "3", "4", "5"].map((id) => station(id)))
    );
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    const harness = createHarness();
    harness.context.audio.playSound = mock(
      () =>
        new Promise<void>((resolve) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          releases.push(() => {
            active -= 1;
            resolve();
          });
        })
    );
    await harness.playback.activate();

    const playing = harness.playback.playAll();
    await Promise.resolve();
    await Promise.resolve();

    expect(releases).toHaveLength(3);
    for (const release of releases.splice(0, 3)) {
      release();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(releases).toHaveLength(2);
    for (const release of releases.splice(0)) {
      release();
    }
    await playing;

    expect(maximumActive).toBe(3);
  });

  test("pause-all cancels queued starts and re-pauses late completions", async () => {
    const ids = ["1", "2", "3", "4", "5"];
    insertNodeSession(patch(ids.map((id) => station(id))));
    const harness = createHarness();
    const { releases, started } = heldStarts(harness.context);
    harness.context.audio.pauseSound = mock((soundId: string) => {
      setPlaybackChannelRuntime(soundId.slice("node:".length), () => ({
        isPlaying: false,
      }));
    });
    await harness.playback.activate();

    const playing = harness.playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    const initialReleases = releases.splice(0);
    harness.playback.pauseAll();
    for (const release of initialReleases) {
      release();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (const release of releases.splice(0)) {
      release();
    }
    await playing;

    expect(started).toHaveLength(3);
    for (const id of ids) {
      expect(getPlaybackChannelRuntime(channelOf(id)).isPlaying).toBe(false);
    }
  });

  test("pause-all suppresses a rejected in-flight start", async () => {
    insertNodeSession(patch([station("a")]));
    let rejectStart: (reason?: unknown) => void = () => undefined;
    const harness = createHarness();
    harness.context.audio.playSound = mock(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStart = reject;
        })
    );
    await harness.playback.activate();

    const playing = harness.playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    harness.playback.pauseAll();
    rejectStart(new Error("failure after pause"));
    await playing;

    expect(getPlaybackChannelRuntime(channelOf("a")).error).toBeNull();
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test("keeps a manual resume after a paused play-all worker settles", async () => {
    insertNodeSession(patch([station("a")]));
    const channelId = channelOf("a");
    let releaseOldStart: () => void = () => undefined;
    let startCount = 0;
    const harness = createHarness();
    harness.context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve) => {
          startCount += 1;
          if (startCount === 1) {
            releaseOldStart = resolve;
            return;
          }
          setPlaybackChannelRuntime(channelId, () => ({
            isPlaying: true,
            soundId,
          }));
          resolve();
        })
    );
    harness.context.audio.pauseSound = mock(() => {
      setPlaybackChannelRuntime(channelId, () => ({ isPlaying: false }));
    });
    await harness.playback.activate();

    const oldPlayAll = harness.playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    harness.playback.pauseAll();
    await harness.playback.setPlaying("a", true);
    releaseOldStart();
    await oldPlayAll;

    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      isPlaying: true,
      soundId: soundOf("a"),
    });
  });

  test("a newer pause reclaims an older paused start from a manual resume", async () => {
    insertNodeSession(patch([station("a")]));
    const channelId = channelOf("a");
    let releaseOldStart: () => void = () => undefined;
    let startCount = 0;
    const harness = createHarness();
    harness.context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve) => {
          startCount += 1;
          const start = () => {
            setPlaybackChannelRuntime(channelId, () => ({
              isPlaying: true,
              soundId,
            }));
            resolve();
          };
          if (startCount === 1) {
            releaseOldStart = start;
            return;
          }
          start();
        })
    );
    harness.context.audio.pauseSound = mock(() => {
      setPlaybackChannelRuntime(channelId, () => ({ isPlaying: false }));
    });
    await harness.playback.activate();

    const oldPlayAll = harness.playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    harness.playback.pauseAll();
    await harness.playback.setPlaying("a", true);
    harness.playback.pauseAll();
    releaseOldStart();
    await oldPlayAll;

    expect(getPlaybackChannelRuntime(channelId).isPlaying).toBe(false);
  });

  test("ignores a rejected start after a newer start wins", async () => {
    insertNodeSession(patch([station("a")]));
    const channelId = channelOf("a");
    let rejectStaleStart: (reason?: unknown) => void = () => undefined;
    let attempt = 0;
    const harness = createHarness();
    harness.context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve, reject) => {
          attempt += 1;
          if (attempt === 1) {
            rejectStaleStart = reject;
            return;
          }
          setPlaybackChannelRuntime(channelId, () => ({
            isPlaying: true,
            soundId,
          }));
          resolve();
        })
    );
    await harness.playback.activate();

    const staleStart = harness.playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    await harness.playback.setPlaying("a", true);
    rejectStaleStart(new Error("superseded start failure"));
    await staleStart;

    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      error: null,
      isPlaying: true,
      soundId: soundOf("a"),
    });
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test("removing a Station suppresses its deferred start rejection", async () => {
    insertNodeSession(patch([station("a")]));
    const channelId = channelOf("a");
    let rejectStart: (reason?: unknown) => void = () => undefined;
    const harness = createHarness();
    harness.context.audio.playSound = mock(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStart = reject;
        })
    );
    await harness.playback.activate();

    const playing = harness.playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    await commit(harness, () => patch([]));
    rejectStart(new Error("failure after removal"));
    await playing;

    expect(getPlaybackSession("node")?.channels).toEqual([]);
    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      error: null,
      isPlaying: false,
      soundId: null,
    });
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test("removing a Station cleans its deferred start completion", async () => {
    insertNodeSession(patch([station("a")]));
    const channelId = channelOf("a");
    let resolveStart: () => void = () => undefined;
    const harness = createHarness();
    harness.context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve) => {
          resolveStart = () => {
            setPlaybackChannelRuntime(channelId, () => ({
              isPlaying: true,
              soundId,
            }));
            resolve();
          };
        })
    );
    await harness.playback.activate();

    const playing = harness.playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    await commit(harness, () => patch([]));
    resolveStart();
    await playing;

    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      error: null,
      isPlaying: false,
      soundId: null,
    });
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test("removing a Station cleans an older superseded start completion", async () => {
    insertNodeSession(patch([station("a")]));
    const channelId = channelOf("a");
    let resolveStaleStart: () => void = () => undefined;
    let attempt = 0;
    const harness = createHarness();
    harness.context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve) => {
          attempt += 1;
          const start = () => {
            setPlaybackChannelRuntime(channelId, () => ({
              isPlaying: true,
              soundId,
            }));
            resolve();
          };
          if (attempt === 1) {
            resolveStaleStart = start;
            return;
          }
          start();
        })
    );
    await harness.playback.activate();

    const staleStart = harness.playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    await harness.playback.setPlaying("a", true);
    await commit(harness, () => patch([]));
    resolveStaleStart();
    await staleStart;
    await harness.playback.whenSettled();

    expect(getPlaybackSession("node")?.channels).toEqual([]);
    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      error: null,
      isPlaying: false,
      soundId: null,
    });
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test("keeps play-all failures local to their lane and reports them as node", async () => {
    insertNodeSession(patch([station("good"), station("bad")]));
    const harness = createHarness();
    harness.context.audio.playSound = mock((soundId: string) =>
      soundId.includes("bad")
        ? Promise.reject(new Error("raw failed stream detail"))
        : Promise.resolve()
    );
    await harness.playback.activate();

    await harness.playback.playAll();

    expect(getPlaybackChannelRuntime(channelOf("good")).error).toBeNull();
    expect(getPlaybackChannelRuntime(channelOf("bad")).error).toMatchObject({
      code: "PLAY_ERROR",
      message:
        "The stream could not be reached. Check the station URL and try again.",
    });
    expect(harness.context.reportError).toHaveBeenCalledTimes(1);
    expect(harness.context.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: channelOf("bad"),
        code: "PLAY_ERROR",
        mode: "node",
      })
    );
  });

  test("reconciles main output settings when playback starts a lane", async () => {
    insertNodeSession(patch([station("a")]));
    const patches: unknown[] = [];
    const context = createTestContext();
    context.lifecycle.mainOutputSettingsApplied = false;
    context.getMainOutputRouter = () =>
      ({
        applyMainSettings: (settings: unknown) => {
          patches.push(settings);
          return Promise.resolve({});
        },
        applySettings: () => {
          throw new Error("full output transaction should not run");
        },
      }) as unknown as OutputRouting;
    const harness = createHarness({ context });
    await harness.playback.activate();

    await harness.playback.setPlaying("a", true);

    expect(patches).toEqual([
      {
        mainDelayMs: expect.any(Number),
        mainOutputId: expect.any(String),
      },
    ]);
    expect(context.lifecycle.mainOutputSettingsApplied).toBe(true);
  });

  test("activation restores valid Stations; a local file from an earlier page has no lane", async () => {
    const local = {
      ...radio("local"),
      platformMetadata: {
        displayName: "Local",
        duration: 10,
        fileName: "local.mp3",
        fileSize: 100,
        itemType: "track",
        mimeType: "audio/mpeg",
        objectUrl: "blob:https://radio.example/local",
        platform: "local-file",
        url: "",
      },
      streamUrl: "blob:https://radio.example/local",
    } as Radio;
    insertNodeSession(
      patch([station("valid"), station("local", { radio: local })])
    );
    const harness = createHarness();

    await harness.playback.activate();

    expect(getPlaybackChannelRuntime(channelOf("valid")).soundId).toBe(
      soundOf("valid")
    );
    expect(getPlaybackChannel("node", channelOf("local"))).toBeUndefined();
    expect(getPlaybackChannelRuntime(channelOf("local"))).toMatchObject({
      isPlaying: false,
      soundId: null,
    });
  });
});

describe("Node Playback budget", () => {
  test("refuses a fifth playing stream on mobile with a message", async () => {
    const ids = ["1", "2", "3", "4", "5"];
    insertNodeSession(patch(ids.map((id) => station(id))));
    const harness = createHarness({ profile: "mobile" });
    instantStarts(harness.context);
    await harness.playback.activate();

    await harness.playback.setPlaying("1", true);
    await harness.playback.setPlaying("2", true);
    await harness.playback.setPlaying("3", true);
    await harness.playback.setPlaying("4", true);
    await harness.playback.setPlaying("5", true);

    expect(harness.context.audio.playSound).toHaveBeenCalledTimes(4);
    expect(harness.context.audio.playSound).not.toHaveBeenCalledWith(
      soundOf("5"),
      expect.anything()
    );
    expect(getPlaybackChannelRuntime(channelOf("5"))).toMatchObject({
      error: {
        code: "PLAY_ERROR",
        message:
          "Up to 4 streams can play at once here. Pause one to start this.",
      },
      isPlaying: false,
    });
    expect(harness.context.reportError).not.toHaveBeenCalled();

    await harness.playback.setPlaying("1", false);
    await harness.playback.setPlaying("5", true);

    expect(getPlaybackChannelRuntime(channelOf("5"))).toMatchObject({
      error: null,
      isPlaying: true,
    });
  });

  test("play-all on mobile starts four streams and refuses the rest", async () => {
    const ids = ["1", "2", "3", "4", "5", "6"];
    insertNodeSession(patch(ids.map((id) => station(id))));
    const harness = createHarness({ profile: "mobile" });
    instantStarts(harness.context);
    await harness.playback.activate();

    await harness.playback.playAll();

    expect(harness.context.audio.playSound).toHaveBeenCalledTimes(4);
    expect(
      ids.filter((id) => getPlaybackChannelRuntime(channelOf(id)).isPlaying)
    ).toHaveLength(4);
    expect(
      ids.filter(
        (id) =>
          getPlaybackChannelRuntime(channelOf(id)).error?.message ===
          "Up to 4 streams can play at once here. Pause one to start this."
      )
    ).toHaveLength(2);
  });

  test("desktop allows six playing streams", async () => {
    const ids = ["1", "2", "3", "4", "5", "6", "7"];
    insertNodeSession(patch(ids.map((id) => station(id))));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();

    await harness.playback.playAll();

    expect(harness.context.audio.playSound).toHaveBeenCalledTimes(6);
  });
});

describe("Node Playback across tabs", () => {
  const micInput = (monitor: boolean): NodeInput =>
    ({
      data: {
        channelSelection: { left: 0, right: 1 },
        deviceId: "usb-mic",
        deviceLabel: "Desk mic",
        strip: { monitor },
      },
      id: "mic",
      position: { x: 0, y: 200 },
      type: "deviceIn",
    }) as NodeInput;

  test("takes in another tab's newer patch as no undo step, without writing it back", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    await harness.playback.activate();
    commitNodeGraph(
      withStation("a", { volume: 0.5 }),
      harness.store,
      "snapshot"
    );
    await harness.playback.whenSettled();
    expect(harness.store.state.history.past).toHaveLength(1);

    const written = await writeFromOtherTab(
      harness,
      patch([station("a", { volume: 0.3 }), station("b")])
    );

    expect(getPlaybackSession("node")).toBe(written);
    expect(stationData(harness.store, "a")?.volume).toBe(0.3);
    expect(stationData(harness.store, "b")).toBeDefined();
    expect(harness.context.channels.activate).toHaveBeenCalledWith(
      "node",
      channelOf("b"),
      expect.objectContaining({ id: "b" }),
      soundOf("b")
    );
    // Undo can't bring back the patch the other tab replaced.
    expect(harness.store.state.history.past).toEqual([]);
    expect(undoNodeGraph(harness.store)).toBe(false);
  });

  test("this tab's next edit builds on the other tab's patch", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    await harness.playback.activate();
    await writeFromOtherTab(harness, patch([station("a"), station("b")]));

    await commit(harness, withStation("a", { volume: 0.2 }));

    const stored = getPlaybackSession("node")?.graph;
    expect(stored?.nodes.map((node) => node.id).sort()).toEqual([
      "a",
      "b",
      "speakers",
    ]);
    expect(stored?.nodes.find((node) => node.id === "a")?.data).toMatchObject({
      volume: 0.2,
    });
  });

  test("an unchanged patch, or another tab's Monitor, leaves this tab's editor as it is", async () => {
    const own = patch([station("a"), micInput(false)]);
    insertNodeSession(own);
    const harness = createHarness();
    await harness.playback.activate();
    commitNodeGraph(
      withStation("a", { volume: 0.4 }),
      harness.store,
      "snapshot"
    );
    await harness.playback.whenSettled();
    const { graph, history } = harness.store.state;
    if (!graph) {
      throw new Error("No graph");
    }

    await writeFromOtherTab(harness, graph);
    await writeFromOtherTab(harness, {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.type === "deviceIn"
          ? {
              ...node,
              data: {
                ...node.data,
                strip: { ...node.data.strip, monitor: true },
              },
            }
          : node
      ),
    });

    expect(harness.store.state.graph).toBe(graph);
    expect(harness.store.state.history).toBe(history);
  });

  test("keeps each tab's own Monitor when it takes in a patch", async () => {
    insertNodeSession(patch([station("a"), micInput(false)]));
    const harness = createHarness();
    await harness.playback.activate();
    commitNodeGraph(
      (graph) => setSourceStrip(graph, "mic", { monitor: true }),
      harness.store,
      "rebase"
    );
    await harness.playback.whenSettled();

    await writeFromOtherTab(
      harness,
      patch([station("a", { volume: 0.6 }), micInput(false)])
    );

    const mic = harness.store.state.graph?.nodes.find(
      (node) => node.id === "mic"
    );
    expect(stationData(harness.store, "a")?.volume).toBe(0.6);
    expect(mic?.type === "deviceIn" && mic.data.strip.monitor).toBe(true);
  });

  test("keeps an edit made while another tab's patch loads, and says so", async () => {
    const warning = spyOn(toast, "warning");
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    await harness.playback.activate();

    await writeFromOtherTab(harness, patch([station("a"), station("b")]), () =>
      commitNodeGraph(withStation("a", { volume: 0.2 }), harness.store)
    );

    expect(stationData(harness.store, "b")).toBeUndefined();
    expect(
      getPlaybackSession("node")?.graph?.nodes.find((node) => node.id === "a")
        ?.data
    ).toMatchObject({ volume: 0.2 });
    expect(warning).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });

  test("stops hearing other tabs once Node stops", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    await harness.playback.activate();
    expect(harness.otherTabListeners.size).toBe(1);

    await harness.playback.deactivate();

    expect(harness.otherTabListeners.size).toBe(0);
  });
});

describe("Node Playback deactivation", () => {
  test("cancels queued starts and cleans late completions", async () => {
    const ids = ["1", "2", "3", "4", "5"];
    insertNodeSession(patch(ids.map((id) => station(id))));
    const harness = createHarness();
    const { releases, started } = heldStarts(harness.context);
    await harness.playback.activate();

    const playing = harness.playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    const initialReleases = releases.splice(0);
    await harness.playback.deactivate();
    for (const release of initialReleases) {
      release();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (const release of releases.splice(0)) {
      release();
    }
    await playing;

    expect(started).toHaveLength(3);
    for (const id of ids) {
      expect(getPlaybackChannelRuntime(channelOf(id))).toMatchObject({
        isPlaying: false,
        soundId: null,
      });
    }
  });

  test("suppresses a rejected in-flight start", async () => {
    insertNodeSession(patch([station("a")]));
    let rejectStart: (reason?: unknown) => void = () => undefined;
    const harness = createHarness();
    harness.context.audio.playSound = mock(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStart = reject;
        })
    );
    await harness.playback.activate();

    const playing = harness.playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    await harness.playback.deactivate();
    rejectStart(new Error("failure after deactivation"));
    await playing;

    expect(getPlaybackChannelRuntime(channelOf("a"))).toMatchObject({
      error: null,
      isPlaying: false,
      soundId: null,
    });
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test("cleans a lane started while another lane fades", async () => {
    insertNodeSession(patch([station("a"), station("b")]));
    const fade = Promise.withResolvers<void>();
    const harness = createHarness({ fadeOutSound: () => fade.promise });
    await harness.playback.activate();
    setPlaybackChannelRuntime(channelOf("a"), () => ({ isPlaying: true }));
    // b has not been created yet when deactivate starts fading a.
    resetPlaybackChannelRuntime(channelOf("b"));

    const deactivation = harness.playback.deactivate();
    await Promise.resolve();
    expect(harness.fadeOutSound).toHaveBeenCalledWith(soundOf("a"), 150, true);
    await harness.playback.setPlaying("b", true);
    fade.resolve();
    await deactivation;

    expect(getPlaybackChannelRuntime(channelOf("b"))).toMatchObject({
      isPlaying: false,
      soundId: null,
    });
  });

  test("keeps a newer play-all start after a deactivated worker settles", async () => {
    insertNodeSession(patch([station("a")]));
    const channelId = channelOf("a");
    let releaseOldStart: () => void = () => undefined;
    let startCount = 0;
    const harness = createHarness();
    harness.context.audio.playSound = mock(
      (soundId: string) =>
        new Promise<void>((resolve) => {
          startCount += 1;
          if (startCount === 1) {
            releaseOldStart = () => {
              setPlaybackChannelRuntime(channelId, () => ({
                isPlaying: true,
              }));
              resolve();
            };
            return;
          }
          setPlaybackChannelRuntime(channelId, () => ({
            isPlaying: true,
            soundId,
          }));
          resolve();
        })
    );
    await harness.playback.activate();

    const oldPlayAll = harness.playback.playAll();
    await Promise.resolve();
    await Promise.resolve();
    await harness.playback.deactivate();
    await harness.playback.activate();
    await harness.playback.playAll();
    releaseOldStart();
    await oldPlayAll;

    expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
      isPlaying: true,
      soundId: soundOf("a"),
    });
  });

  test("owns orphan cleanup and leaves no n:* sound behind", async () => {
    insertNodeSession(patch([station("a")]));
    const liveSounds = new Set<string>();
    const context = createTestContext();
    const { activate } = context.channels;
    context.channels.activate = mock((...args: Parameters<typeof activate>) => {
      const soundId = activate(...args);
      liveSounds.add(soundId);
      return soundId;
    });
    // The channel facade forgets the sound; only the orphan check finds it.
    context.channels.deactivate = mock((channelId: string) => {
      resetPlaybackChannelRuntime(channelId);
    });
    context.audio.hasSound = mock((soundId: string) => liveSounds.has(soundId));
    context.audio.cleanupSound = mock((soundId: string) => {
      liveSounds.delete(soundId);
    });
    const harness = createHarness({ context });
    await harness.playback.activate();
    setPlaybackChannelRuntime("n:orphan", () => ({
      error: {
        code: "STREAM_ABORTED",
        id: "stale",
        message: "stale",
        timestamp: 1,
      },
      isPlaying: true,
      soundId: "node:n:orphan",
    }));
    liveSounds.add("node:n:orphan");

    await harness.playback.deactivate();

    expect(liveSounds.size).toBe(0);
    expect(harness.fadeOutSound).toHaveBeenCalledWith(soundOf("a"), 150, true);
    for (const channelId of [channelOf("a"), "n:orphan"]) {
      expect(getPlaybackChannelRuntime(channelId)).toMatchObject({
        error: null,
        isPlaying: false,
        soundId: null,
      });
    }
  });
});

describe("Node Playback native strip", () => {
  function strip(pan: number, filter: boolean): NodeGraph {
    const nodes: NodeInput[] = [
      station("a"),
      {
        data: { pan },
        id: "pan",
        position: { x: 120, y: 0 },
        type: "pan",
      } as NodeInput,
      speakers,
    ];
    const edges = [cable("pan", "speakers")];
    if (filter) {
      nodes.push({
        data: { frequency: 800, Q: 1, type: "lowpass" },
        id: "filter",
        position: { x: 60, y: 0 },
        type: "filter",
      } as NodeInput);
      edges.push(cable("a", "filter"), cable("filter", "pan"));
    } else {
      edges.push(cable("a", "pan"));
    }
    return nodeGraphSchema.parse({ edges, nodes, version: 2 });
  }

  test("a pan back to centre and a removed filter reach a playing sound", async () => {
    insertNodeSession(strip(0.5, true));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);

    expect(harness.context.audio.setPan).toHaveBeenLastCalledWith(
      soundOf("a"),
      0.5
    );
    expect(harness.context.audio.updateFilter).toHaveBeenLastCalledWith(
      soundOf("a"),
      expect.objectContaining({
        enabled: true,
        frequency: 800,
        type: "lowpass",
      })
    );

    await commit(harness, () => strip(0, false));

    expect(harness.context.audio.setPan).toHaveBeenLastCalledWith(
      soundOf("a"),
      0
    );
    expect(harness.context.audio.updateFilter).toHaveBeenLastCalledWith(
      soundOf("a"),
      expect.objectContaining({ enabled: false })
    );
    expect(harness.context.channels.activate).toHaveBeenCalledTimes(1);
  });

  test("the strip reaches a starting sound before its stream plays", async () => {
    insertNodeSession(strip(0.5, true));
    const harness = createHarness();
    const { releases } = heldStarts(harness.context);
    await harness.playback.activate();

    const start = harness.playback.setPlaying("a", true);

    expect(harness.context.audio.setPan).toHaveBeenCalledWith(
      soundOf("a"),
      0.5
    );
    expect(harness.context.audio.updateFilter).toHaveBeenCalledWith(
      soundOf("a"),
      expect.objectContaining({ enabled: true, type: "lowpass" })
    );
    releases[0]?.();
    await start;
  });

  /** An engine whose sounds get nodes in their play call, as AudioManager's do. */
  function nodesOnPlay(context: PlaybackActionContext) {
    const calls: string[] = [];
    const withNodes = new Set<string>();
    let connect: SoundOutputConnector | null = null;
    Object.assign(context.audio, {
      getPreFaderNode: mock((soundId: string) =>
        withNodes.has(soundId) ? { soundId } : null
      ),
      playSound: mock((soundId: string) => {
        // Nodes, then the graph connects, then the stream is asked to play.
        withNodes.add(soundId);
        connect?.(
          createFakeFader(new FakeAudioContext()).node,
          false,
          () => () => undefined
        );
        calls.push("stream");
        setPlaybackChannelRuntime(soundId.slice("node:".length), () => ({
          isPlaying: true,
        }));
        return Promise.resolve();
      }),
      setPan: mock((_soundId: string, pan: number) => {
        calls.push(`pan ${pan}`);
      }),
      setSoundOutputConnector: mock(
        (_soundId: string, connector: SoundOutputConnector | null) => {
          connect = connector;
        }
      ),
    });
    return calls;
  }

  test("a new sound's strip is on its nodes before its stream starts", async () => {
    insertNodeSession(strip(0.5, true));
    const harness = createHarness();
    const calls = nodesOnPlay(harness.context);
    await harness.playback.activate();

    await harness.playback.setPlaying("a", true);

    expect(calls.slice(0, 2)).toEqual(["pan 0.5", "stream"]);
  });

  test("a strip change made while paused is on the sound before it resumes", async () => {
    insertNodeSession(strip(0.5, false));
    const harness = createHarness();
    const calls = nodesOnPlay(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    await harness.playback.setPlaying("a", false);
    calls.length = 0;

    await commit(harness, () => strip(-0.5, false));
    await harness.playback.setPlaying("a", true);

    expect(calls.indexOf("pan -0.5")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("pan -0.5")).toBeLessThan(calls.indexOf("stream"));
  });

  test("a strip change made while paused applies when the Station resumes", async () => {
    insertNodeSession(strip(0.5, false));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    await harness.playback.setPlaying("a", false);

    await commit(harness, () => strip(0, false));
    await harness.playback.setPlaying("a", true);

    expect(harness.context.audio.setPan).toHaveBeenLastCalledWith(
      soundOf("a"),
      0
    );
  });
});

describe("Node Playback settling lanes", () => {
  test("a removed lane whose release throws still settles, unhandled nowhere", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const warnings = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      insertNodeSession(patch([station("a")]));
      const harness = createHarness();
      instantStarts(harness.context);
      await harness.playback.activate();
      await harness.playback.setPlaying("a", true);
      harness.context.channels.deactivate = mock((_channelId: string) => {
        throw new Error("cleanup failed");
      });

      commitNodeGraph(withStation("a", { radio: radio("a2") }), harness.store);
      harness.playback.flush();

      await expect(
        harness.playback.setPlaying("a", true)
      ).resolves.toBeUndefined();
      await harness.playback.whenSettled();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      warnings.mockRestore();
    }
  });

  test("a pause during an in-place stream change keeps the Station paused", async () => {
    insertNodeSession(patch([station("a")]));
    const fade = Promise.withResolvers<void>();
    const harness = createHarness({ fadeOutSound: () => fade.promise });
    instantStarts(harness.context);
    await harness.playback.activate();
    setPlaybackChannelRuntime(channelOf("a"), () => ({ isPlaying: true }));
    const saved = { ...radio("a"), id: "saved-a" };

    commitNodeGraph(withStation("a", { radio: saved }), harness.store);
    await Promise.resolve();
    await Promise.resolve();
    await harness.playback.setPlaying("a", false);
    fade.resolve();
    await harness.playback.whenSettled();

    expect(harness.context.channels.activate).toHaveBeenLastCalledWith(
      "node",
      channelOf("a"),
      saved,
      soundOf("a")
    );
    expect(harness.context.audio.playSound).not.toHaveBeenCalled();
  });

  test("a start waiting on a fading lane does not run after deactivate", async () => {
    insertNodeSession(patch([station("a")]));
    const fade = Promise.withResolvers<void>();
    const harness = createHarness({ fadeOutSound: () => fade.promise });
    instantStarts(harness.context);
    await harness.playback.activate();

    commitNodeGraph(
      withStation("a", { radio: { ...radio("a"), id: "saved-a" } }),
      harness.store
    );
    await Promise.resolve();
    await Promise.resolve();
    const start = harness.playback.setPlaying("a", true);
    const deactivation = harness.playback.deactivate();
    fade.resolve();
    await Promise.all([start, deactivation]);
    await harness.playback.whenSettled();

    expect(harness.context.audio.playSound).not.toHaveBeenCalled();
    expect(getPlaybackChannelRuntime(channelOf("a"))).toMatchObject({
      isPlaying: false,
      soundId: null,
    });
  });

  test("a removed playing Station added back in a later commit stays paused", async () => {
    insertNodeSession(patch([station("a"), station("b")]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);

    await commit(harness, () => patch([station("b")]));
    await commit(harness, () => patch([station("a"), station("b")]));

    expect(harness.context.audio.playSound).toHaveBeenCalledTimes(1);
    expect(getPlaybackChannelRuntime(channelOf("a")).isPlaying).toBe(false);
  });
});

describe("Node Playback lane outputs", () => {
  /** The connector last registered for a lane's sound, if any. */
  function registeredConnector(
    context: PlaybackActionContext,
    nodeId: string
  ): SoundOutputConnector | null {
    const register = context.audio.setSoundOutputConnector as ReturnType<
      typeof mock<
        (soundId: string, connect: SoundOutputConnector | null) => void
      >
    >;
    const calls = register.mock.calls.filter(
      ([soundId]) => soundId === soundOf(nodeId)
    );
    return calls.at(-1)?.[1] ?? null;
  }

  /** What AudioManager does when the lane's sound connects its graph. */
  function connectLane(context: PlaybackActionContext, nodeId: string) {
    const connect = registeredConnector(context, nodeId);
    if (!connect) {
      throw new Error(`no output connector for ${nodeId}`);
    }
    const audio = new FakeAudioContext();
    const { fader, node } = createFakeFader(audio);
    const releaseMain = mock(() => undefined);
    const connectMain = mock<MainOutputConnect>(() => releaseMain);
    connect(node, false, connectMain);
    const laneOut = [...fader.connections][0] as FakeGainNode;
    /** The lane's send into its only sink, Speakers, once it has one. */
    const send = () => [...laneOut.connections][0] as FakeGainNode | undefined;
    return { audio, connectMain, fader, laneOut, releaseMain, send };
  }

  function levelOf(send: FakeGainNode | undefined) {
    const last = send?.gain.events.at(-1);
    return last?.type === "target" ? last.value : null;
  }

  function withCable(
    edgeId: string,
    update: { gain?: number; muted?: boolean }
  ) {
    return (graph: NodeGraph): NodeGraph => ({
      ...graph,
      edges: graph.edges.map((edge) =>
        edge.id === edgeId ? { ...edge, ...update } : edge
      ),
    });
  }

  test("a start registers the lane's connector before its play call", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    const calls: string[] = [];
    harness.context.audio.setSoundOutputConnector = mock((soundId: string) => {
      calls.push(`connector ${soundId}`);
    });
    harness.context.audio.playSound = mock((soundId: string) => {
      calls.push(`play ${soundId}`);
      return Promise.resolve();
    });
    await harness.playback.activate();

    // Activation builds the lane paused and leaves the engine alone.
    expect(calls).toEqual([]);

    const started = harness.playback.setPlaying("a", true);

    // No await yet: the connector is in place inside the gesture.
    expect(calls).toEqual([
      `connector ${soundOf("a")}`,
      `play ${soundOf("a")}`,
    ]);
    await started;
    await harness.playback.setPlaying("a", false);
    await harness.playback.setPlaying("a", true);
    expect(calls.filter((call) => call.startsWith("connector"))).toHaveLength(
      1
    );
  });

  test("cable gain, mute and removal ramp the Speakers send with τ 5 ms and leave the fader alone", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    const { connectMain, fader, laneOut, send } = connectLane(
      harness.context,
      "a"
    );

    expect(connectMain).toHaveBeenCalledWith(send(), false);
    expect(fader.connections.has(laneOut)).toBe(true);
    expect(send()?.gain.value).toBe(0);
    expect(levelOf(send())).toBe(1);

    await commit(harness, withCable("a->speakers", { muted: true }));
    expect(send()?.gain.events.at(-1)).toEqual({
      time: 0,
      timeConstant: LANE_LEVEL_TIME_CONSTANT_S,
      type: "target",
      value: 0,
    });

    await commit(
      harness,
      withCable("a->speakers", { gain: 0.5, muted: false })
    );
    expect(levelOf(send())).toBe(0.5);

    await commit(harness, (graph) => ({ ...graph, edges: [] }));
    expect(levelOf(send())).toBe(0);

    await commit(harness, () => patch([station("a")]));
    expect(levelOf(send())).toBe(1);

    expect(fader.gain.events).toEqual([]);
    expect(fader.gain.value).toBe(0.8);
    expect(harness.context.channels.setVolume).not.toHaveBeenCalled();
    expect(harness.context.channels.activate).toHaveBeenCalledTimes(1);
  });

  test("a Station whose stream changes fades the old one out at its old level", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    const old = connectLane(harness.context, "a");
    const oldSend = old.send();
    const eventsBefore = oldSend?.gain.events.length;
    const saved = { ...radio("a"), id: "saved-a" };

    await commit(harness, (graph) =>
      withCable("a->speakers", { muted: true })(
        withStation("a", { radio: saved })(graph)
      )
    );

    expect(harness.fadeOutSound).toHaveBeenCalledWith(soundOf("a"), 150, true);
    expect(oldSend?.gain.events).toHaveLength(eventsBefore ?? -1);
    expect(levelOf(oldSend)).toBe(1);
    // The new stream's send starts at the new level.
    const next = connectLane(harness.context, "a");
    expect(next.send()).not.toBe(oldSend);
    expect(levelOf(next.send())).toBe(0);
  });

  test("a Station with no cable to Speakers plays silent", async () => {
    insertNodeSession(
      nodeGraphSchema.parse({
        edges: [],
        nodes: [station("a"), speakers],
        version: 2,
      })
    );
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);

    const { laneOut } = connectLane(harness.context, "a");

    // No cable, no send: laneOut feeds nothing.
    expect(laneOut.connections.size).toBe(0);
  });

  test("an FX layout change ducks laneOut, swaps the tree, then ramps back", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    const { audio, fader, laneOut } = connectLane(harness.context, "a");
    audio.currentTime = 2;
    laneOut.gain.value = 1;

    commitNodeGraph(
      () =>
        nodeGraphSchema.parse({
          edges: [cable("a", "verb"), cable("verb", "speakers")],
          nodes: [station("a"), reverb("verb"), speakers],
          version: 2,
        }),
      harness.store
    );
    harness.playback.flush();

    expect(laneOut.gain.events.at(-1)).toEqual({
      time: 2 + LANE_DUCK_MS / 1000,
      type: "linear",
      value: 0,
    });
    expect(harness.effectsChange).not.toHaveBeenCalled();

    laneOut.gain.value = 0;
    audio.currentTime = 2.1;
    await harness.playback.whenSettled();

    expect(harness.effectsChange).toHaveBeenCalledTimes(1);
    expect(harness.effectsChange).toHaveBeenCalledWith(
      { channelId: channelOf("a"), sessionId: "node" },
      { tree: [expect.objectContaining({ id: "verb" })], type: "replace" }
    );
    expect(laneOut.gain.events.at(-1)).toEqual({
      time: 2.1 + LANE_DUCK_MS / 1000,
      type: "linear",
      value: 1,
    });
    expect(fader.gain.events).toEqual([]);
  });

  test("an FX param change during the duck waits for the swap, which applies the latest tree", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    connectLane(harness.context, "a");

    const withReverb = (dryWet: number) => () =>
      nodeGraphSchema.parse({
        edges: [cable("a", "verb"), cable("verb", "speakers")],
        nodes: [station("a"), reverb("verb", { dryWet }), speakers],
        version: 2,
      });
    commitNodeGraph(withReverb(0.5), harness.store);
    harness.playback.flush();
    // Same layout, new param, while the lane is still ducking.
    commitNodeGraph(withReverb(0.25), harness.store);
    harness.playback.flush();

    // The new layout must not be applied before the lane is silent.
    expect(harness.effectsChange).not.toHaveBeenCalled();

    await harness.playback.whenSettled();

    expect(harness.effectsChange).toHaveBeenCalledTimes(1);
    expect(harness.effectsChange).toHaveBeenLastCalledWith(
      { channelId: channelOf("a"), sessionId: "node" },
      {
        tree: [expect.objectContaining({ dryWet: 0.25, id: "verb" })],
        type: "replace",
      }
    );
    expect(getPlaybackChannel("node", channelOf("a"))?.effects).toEqual([
      expect.objectContaining({ dryWet: 0.25, id: "verb" }),
    ]);

    // Once the swap has replaced, param changes apply at once again.
    commitNodeGraph(withReverb(0.75), harness.store);
    await harness.playback.whenSettled();
    expect(harness.effectsChange).toHaveBeenCalledTimes(2);
    expect(harness.effectsChange).toHaveBeenLastCalledWith(
      { channelId: channelOf("a"), sessionId: "node" },
      {
        tree: [expect.objectContaining({ dryWet: 0.75, id: "verb" })],
        type: "replace",
      }
    );
  });

  test("an FX param change while the swap replaces keeps the duck until the latest tree is in", async () => {
    insertNodeSession(patch([station("a")]));
    const replaces: Array<{
      tree: readonly EffectConfig[];
      done: () => void;
    }> = [];
    const harness = createHarness({
      effects: {
        change: mock((_ref, change) => {
          const { promise, resolve } =
            Promise.withResolvers<ChannelEffectsResult>();
          replaces.push({
            done: () => resolve({} as ChannelEffectsResult),
            tree: change.type === "replace" ? change.tree : [],
          });
          return promise;
        }),
      },
    });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    const { laneOut } = connectLane(harness.context, "a");

    const withReverb = (dryWet: number) => () =>
      nodeGraphSchema.parse({
        edges: [cable("a", "verb"), cable("verb", "speakers")],
        nodes: [station("a"), reverb("verb", { dryWet }), speakers],
        version: 2,
      });
    commitNodeGraph(withReverb(0.5), harness.store);
    harness.playback.flush();
    await new Promise((resolve) => setTimeout(resolve, LANE_DUCK_MS + 10));
    expect(replaces).toHaveLength(1);

    // Same layout, new param, while the swap's replace is still connecting.
    commitNodeGraph(withReverb(0.25), harness.store);
    harness.playback.flush();
    expect(replaces).toHaveLength(1);

    replaces[0]?.done();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(replaces).toHaveLength(2);
    expect(replaces[1]?.tree).toEqual([
      expect.objectContaining({ dryWet: 0.25, id: "verb" }),
    ]);
    expect(laneOut.gain.events.at(-1)).toMatchObject({
      type: "linear",
      value: 0,
    });

    replaces[1]?.done();
    await harness.playback.whenSettled();
    expect(replaces).toHaveLength(2);
    expect(laneOut.gain.events.at(-1)).toMatchObject({
      type: "linear",
      value: 1,
    });
  });

  test("a Station removed during the duck is not given its old tree", async () => {
    insertNodeSession(patch([station("a"), station("b")]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    connectLane(harness.context, "a");

    commitNodeGraph(
      () =>
        nodeGraphSchema.parse({
          edges: [
            cable("a", "verb"),
            cable("verb", "speakers"),
            cable("b", "speakers"),
          ],
          nodes: [station("a"), reverb("verb"), station("b"), speakers],
          version: 2,
        }),
      harness.store
    );
    harness.playback.flush();
    commitNodeGraph(() => patch([station("b")]), harness.store);
    harness.playback.flush();

    await harness.playback.whenSettled();

    expect(harness.effectsChange).not.toHaveBeenCalled();
  });

  test("a removed Station releases its lane output once its channel is gone", async () => {
    insertNodeSession(patch([station("a"), station("b")]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    const { releaseMain } = connectLane(harness.context, "a");
    const order: string[] = [];
    harness.context.channels.deactivate = mock((channelId: string) => {
      order.push(`deactivate ${channelId}`);
      resetPlaybackChannelRuntime(channelId);
    });
    harness.context.audio.setSoundOutputConnector = mock(
      (soundId: string, connect: SoundOutputConnector | null) => {
        order.push(`connector ${soundId} ${connect ? "set" : "cleared"}`);
      }
    );

    await commit(harness, () => patch([station("b")]));

    expect(order).toEqual([
      `deactivate ${channelOf("a")}`,
      `connector ${soundOf("a")} cleared`,
    ]);
    expect(releaseMain).toHaveBeenCalledTimes(1);
  });

  test("deactivate releases every lane output", async () => {
    insertNodeSession(patch([station("a"), station("b")]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    await harness.playback.setPlaying("b", true);
    const a = connectLane(harness.context, "a");
    const b = connectLane(harness.context, "b");

    await harness.playback.deactivate();

    expect(registeredConnector(harness.context, "a")).toBeNull();
    expect(registeredConnector(harness.context, "b")).toBeNull();
    expect(a.releaseMain).toHaveBeenCalledTimes(1);
    expect(b.releaseMain).toHaveBeenCalledTimes(1);
  });
});

describe("Node Playback FX lanes", () => {
  function compressor(id: string): NodeInput {
    return {
      data: {
        effect: { ...createNodeEffectConfig("compressor", id), enabled: true },
      },
      id,
      position: { x: 240, y: 0 },
      type: "compressor",
    } as NodeInput;
  }

  /** Station a → Compressor → Speakers, in place of a's straight cable. */
  function insertCompressor(graph: NodeGraph): NodeGraph {
    return nodeGraphSchema.parse({
      ...graph,
      edges: [cable("a", "comp"), cable("comp", "speakers")],
      nodes: [...graph.nodes, compressor("comp")],
    });
  }

  function threshold(value: number) {
    return (graph: NodeGraph) =>
      setEffectParams(graph, "comp", {
        threshold: value,
      } as Partial<EffectConfig>);
  }

  test("a Compressor inserted between a Station and Speakers joins its lane under its node id, and a knob only sets lane effects", async () => {
    insertNodeSession(patch([station("a")]));
    const swaps: string[] = [];
    const harness = createHarness({
      laneOutputs: (options) => {
        const outputs = createNodeLaneOutputs(options);
        return {
          ...outputs,
          swap: (laneId, replace) => {
            swaps.push(laneId);
            return outputs.swap(laneId, replace);
          },
        };
      },
    });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);

    await commit(harness, insertCompressor);

    const [effect] = getPlaybackChannel("node", channelOf("a"))?.effects ?? [];
    expect(effect).toMatchObject({ id: "comp", type: "compressor" });
    expect(swaps).toEqual(["a"]);
    expect(harness.effectsChange).toHaveBeenCalledTimes(1);

    const before = harness.store.state.graph as NodeGraph;
    await commit(harness, threshold(-24));
    const after = harness.store.state.graph as NodeGraph;

    const env = { crossOriginIsolated: false };
    expect(
      diff(compile(before, env), compile(after, env)).map((op) => op.type)
    ).toEqual(["setLaneEffects"]);
    expect(swaps).toEqual(["a"]);
    expect(harness.effectsChange).toHaveBeenCalledTimes(2);
    expect(harness.effectsChange).toHaveBeenLastCalledWith(
      { channelId: channelOf("a"), sessionId: "node" },
      {
        tree: [expect.objectContaining({ id: "comp", threshold: -24 })],
        type: "replace",
      }
    );
    expect(harness.context.channels.activate).toHaveBeenCalledTimes(1);
    expect(harness.fadeOutSound).not.toHaveBeenCalled();
  });

  test("a 3-band Band Split closed by a Merge plays as one frequencySplit tree in the lane", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    await harness.playback.activate();

    const bandSplit = (graph: NodeGraph): NodeGraph => {
      const band = (index: number, target: string) => ({
        id: `bands.band-${index}`,
        source: "bands",
        sourceHandle: `out:audio:band-${index}`,
        target,
        targetHandle: "in:audio:main",
      });
      const parsed = nodeGraphSchema.parse({
        ...graph,
        edges: [
          cable("a", "bands"),
          band(1, "comp"),
          cable("comp", "merge"),
          band(2, "merge"),
          band(3, "merge"),
          cable("merge", "speakers"),
        ],
        nodes: [
          ...graph.nodes,
          {
            data: {
              effect: {
                ...createNodeEffectConfig("frequencySplit", "bands"),
                enabled: true,
              },
            },
            id: "bands",
            position: { x: 240, y: 0 },
            type: "frequencySplit",
          },
          compressor("comp"),
          { data: {}, id: "merge", position: { x: 480, y: 0 }, type: "merge" },
        ],
      });
      return setBandCount(parsed, "bands", 3);
    };
    await commit(harness, bandSplit);

    const [tree] = getPlaybackChannel("node", channelOf("a"))?.effects ?? [];
    expect(tree).toMatchObject({
      crossoverFrequencies: [200, 1000],
      frequencyBandCount: 3,
      id: "bands",
      type: "frequencySplit",
    });
    expect(
      tree && "chains" in tree
        ? tree.chains.map((chain) => chain.effects.map((effect) => effect.id))
        : null
    ).toEqual([["comp"], [], []]);
    expect(harness.effectsChange).toHaveBeenLastCalledWith(
      { channelId: channelOf("a"), sessionId: "node" },
      {
        tree: [expect.objectContaining({ type: "frequencySplit" })],
        type: "replace",
      }
    );
  });

  test("the backend badge shows compat when not cross-origin isolated, on the lane and its FX", async () => {
    insertNodeSession(insertCompressor(patch([station("a")])));
    const badges = new Store<NodeBackendBadges>({});
    const harness = createHarness({ backendBadges: badges });

    await harness.playback.activate();

    expect(badges.state).toEqual({ a: "compat", comp: "compat" });

    // With the FX off there is no effects runtime, so no badge.
    await commit(harness, (graph) =>
      setEffectParams(graph, "comp", { enabled: false })
    );
    expect(badges.state).toEqual({});
  });

  test("the badge reads bypassed once the controller reports a dry fallback", async () => {
    insertNodeSession(insertCompressor(patch([station("a")])));
    const badges = new Store<NodeBackendBadges>({});
    const harness = createHarness({
      backendBadges: badges,
      crossOriginIsolated: true,
      effectsOutcome: () => ({
        backend: "bypass",
        error: new Error("worklet unavailable"),
        ready: true,
        status: "failed",
      }),
    });
    await harness.playback.activate();

    // Official is the plan, so nothing shows until the controller reports.
    expect(badges.state).toEqual({});

    await commit(harness, threshold(-30));

    expect(badges.state).toEqual({ a: "bypassed", comp: "bypassed" });
  });

  test("switching an FX back on never flashes bypassed while its runtime connects", async () => {
    insertNodeSession(insertCompressor(patch([station("a")])));
    const badges = new Store<NodeBackendBadges>({});
    let outcome: EffectsRuntimeOutcome = {
      backend: "official",
      ready: true,
      status: "ready",
    };
    const harness = createHarness({
      backendBadges: badges,
      crossOriginIsolated: true,
      effectsOutcome: () => outcome,
    });
    await harness.playback.activate();

    // Every FX off: nothing to process, which the controller reports as a
    // ready bypass. That is not a dry fallback.
    outcome = { backend: "bypass", ready: true, status: "ready" };
    await commit(harness, (graph) =>
      setEffectParams(graph, "comp", { enabled: false })
    );
    expect(badges.state).toEqual({});

    const seen: NodeBackendBadges[] = [];
    const subscription = badges.subscribe(() => {
      seen.push(badges.state);
    });
    outcome = { backend: "official", ready: true, status: "ready" };
    await commit(harness, (graph) =>
      setEffectParams(graph, "comp", { enabled: true })
    );
    subscription.unsubscribe();

    expect(
      seen.some((state) => Object.values(state).includes("bypassed"))
    ).toBe(false);
    expect(badges.state).toEqual({});
  });

  test("a start reads the outcome its effects graph settled on", async () => {
    insertNodeSession(insertCompressor(patch([station("a")])));
    const badges = new Store<NodeBackendBadges>({});
    const context = createTestContext();
    context.audio.getEffectsRuntimeOutcome = mock(
      (_soundId: string): EffectsRuntimeOutcome => ({
        backend: "compatibility",
        ready: true,
        status: "ready",
      })
    );
    const harness = createHarness({
      backendBadges: badges,
      context,
      crossOriginIsolated: true,
    });
    instantStarts(context);
    await harness.playback.activate();
    expect(badges.state).toEqual({});

    // Past the official runtime's cap the controller falls back: compat.
    await harness.playback.setPlaying("a", true);

    expect(context.audio.getEffectsRuntimeOutcome).toHaveBeenCalledWith(
      soundOf("a")
    );
    expect(badges.state).toEqual({ a: "compat", comp: "compat" });

    await harness.playback.deactivate();
    expect(badges.state).toEqual({});
  });

  test("laneBackendBadge trusts the controller over the estimate", () => {
    expect(laneBackendBadge(null, "bypass")).toBeNull();
    expect(laneBackendBadge("compat", undefined)).toBe("compat");
    expect(laneBackendBadge("official", undefined)).toBeNull();
    expect(laneBackendBadge("compat", "official")).toBeNull();
    expect(laneBackendBadge("official", "compatibility")).toBe("compat");
    expect(laneBackendBadge("official", "bypass")).toBe("bypassed");
    expect(laneBackendBadge("compat", null)).toBe("compat");
  });
});

describe("Node Playback key cables", () => {
  const KEY_EDGE_ID = "b~>comp";

  /** Station a → Compressor → Speakers; Station b straight to Speakers. */
  function duckPatch(keyed: boolean): NodeGraph {
    return nodeGraphSchema.parse({
      edges: [
        cable("a", "comp"),
        cable("comp", "speakers"),
        cable("b", "speakers"),
        ...(keyed
          ? [
              {
                id: KEY_EDGE_ID,
                source: "b",
                sourceHandle: "out:audio:main",
                target: "comp",
                targetHandle: "in:sidechain:key",
              },
            ]
          : []),
      ],
      nodes: [
        station("a"),
        station("b"),
        {
          data: {
            effect: {
              ...createNodeEffectConfig("compressor", "comp"),
              enabled: true,
            },
          },
          id: "comp",
          position: { x: 240, y: 0 },
          type: "compressor",
        },
        speakers,
      ],
      version: 2,
    });
  }

  /**
   * Real channel effects over a recording runtime, bound as the channel
   * state manager binds them: when a lane's sound is created.
   */
  function withChannelEffects() {
    const desired = new Map<string, DesiredEffectsState>();
    const effects = createChannelEffects({
      runtime: {
        reconcile: (soundId, state) => {
          desired.set(soundId, state);
          return Promise.resolve({
            backend: "compatibility",
            ready: true,
            status: "ready",
          });
        },
      },
    });
    const binds: Promise<unknown>[] = [];
    const context = createTestContext();
    const { activate } = context.channels;
    context.channels.activate = mock((...args: Parameters<typeof activate>) => {
      const soundId = activate(...args);
      const [sessionId, channelId] = args;
      binds.push(effects.bind({ channelId, sessionId }, soundId));
      return soundId;
    });
    const harness = createHarness({ context, effects });
    const settled = async () => {
      await harness.playback.whenSettled();
      await Promise.all(binds);
    };
    return { desired, harness, settled };
  }

  test("a key cable from Station b to a Compressor in a's lane binds b's sound as a's sidechain", async () => {
    insertNodeSession(duckPatch(false));
    const { desired, harness, settled } = withChannelEffects();
    await harness.playback.activate();
    await settled();
    expect(desired.get(soundOf("a"))?.sidechainSoundId).toBeNull();

    await commit(harness, () => duckPatch(true));
    await settled();

    expect(getPlaybackChannel("node", channelOf("a"))?.effects).toEqual([
      expect.objectContaining({
        id: "comp",
        sidechain: { channelId: channelOf("b") },
      }),
    ]);
    expect(desired.get(soundOf("a"))?.sidechainSoundId).toBe(soundOf("b"));
    // The key listens; it never puts FX or a key on b's own lane.
    expect(desired.get(soundOf("b"))?.sidechainSoundId).toBeNull();

    await commit(harness, () => duckPatch(false));
    await settled();
    expect(desired.get(soundOf("a"))?.sidechainSoundId).toBeNull();
  });

  test("a patch opened with its key binds once both lanes exist", async () => {
    insertNodeSession(duckPatch(true));
    const { desired, harness, settled } = withChannelEffects();

    await harness.playback.activate();
    await settled();

    expect(desired.get(soundOf("a"))?.sidechainSoundId).toBe(soundOf("b"));
  });

  test("a Vocoder key overrides its runtime mode and removal restores its authored mode", async () => {
    const keyedPatch = duckPatch(true);
    const vocoderPatch = nodeGraphSchema.parse({
      ...keyedPatch,
      nodes: keyedPatch.nodes.map((node) =>
        node.id === "comp"
          ? {
              ...node,
              data: {
                effect: {
                  ...createNodeEffectConfig("vocoder", "comp"),
                  enabled: true,
                  modulatorSource: "noise-pink",
                },
              },
              type: "vocoder",
            }
          : node
      ),
    });
    insertNodeSession(vocoderPatch);
    const { desired, harness, settled } = withChannelEffects();
    await harness.playback.activate();
    await settled();
    expect(desired.get(soundOf("a"))?.tree[0]).toMatchObject({
      modulatorSource: "external",
      sidechain: { channelId: channelOf("b") },
      type: "vocoder",
    });
    expect(desired.get(soundOf("a"))?.sidechainSoundId).toBe(soundOf("b"));

    await commit(harness, (graph) => removeEdges(graph, [KEY_EDGE_ID]));
    await settled();
    expect(desired.get(soundOf("a"))?.tree[0]).toMatchObject({
      modulatorSource: "noise-pink",
    });
    expect(desired.get(soundOf("a"))?.tree[0]?.sidechain).toBeUndefined();
    expect(desired.get(soundOf("a"))?.sidechainSoundId).toBeNull();
  });
});

/** A shared browser tab's video track, as Chromium reports it. */
const BROWSER_TAB_VIDEO = {
  getSettings: () => ({ displaySurface: "browser" }),
};

describe("Node Playback audio inputs and output devices", () => {
  function mic(id: string, data: Record<string, unknown> = {}): NodeInput {
    return {
      data: {
        channelSelection: { left: 0, right: 1 },
        deviceId: "usb-mic",
        deviceLabel: "Desk mic",
        ...data,
      },
      id,
      position: { x: 0, y: 200 },
      type: "deviceIn",
    } as NodeInput;
  }

  function output(id: string, deviceId: string | null): NodeInput {
    return {
      data: { deviceId },
      id,
      position: { x: 480, y: 200 },
      type: "deviceOut",
    } as NodeInput;
  }

  /** A patch from its nodes and `source>target` cables. */
  function wired(nodes: NodeInput[], cables: string[]): NodeGraph {
    return nodeGraphSchema.parse({
      edges: cables.map((pair) => {
        const [source = "", target = ""] = pair.split(">");
        return cable(source, target);
      }),
      nodes,
      version: 2,
    });
  }

  /** The engine calls a live input makes, recorded in order. */
  function deviceEngine(context: PlaybackActionContext) {
    const calls: string[] = [];
    const active = new Set<string>();
    /** Captures whose track ended, as an unplugged device's does. */
    const ended = new Set<string>();
    Object.assign(context.audio, {
      getDeviceSource: mock((soundId: string) =>
        active.has(soundId)
          ? {
              channelCount: 2,
              cleanup: () => {
                calls.push(`cleanup ${soundId}`);
                active.delete(soundId);
                ended.delete(soundId);
              },
              getDiagnostics: () => ({
                readyState: ended.has(soundId) ? "ended" : "live",
              }),
              isActive: true,
              stop: () => {
                calls.push(`stop ${soundId}`);
                active.delete(soundId);
              },
            }
          : null
      ),
      playDeviceSound: mock(
        (
          soundId: string,
          deviceId: string,
          constraints?: unknown,
          channelSelection?: { left: number; right: number }
        ) => {
          calls.push(
            `playDeviceSound ${soundId} ${deviceId} ${JSON.stringify(constraints)} ${JSON.stringify(channelSelection)}`
          );
          active.add(soundId);
          setPlaybackChannelRuntime(soundId.slice("node:".length), () => ({
            isPlaying: true,
          }));
          return Promise.resolve();
        }
      ),
      setDeviceChannelSelection: mock(
        (soundId: string, selection: { left: number; right: number }) => {
          calls.push(
            `setDeviceChannelSelection ${soundId} ${selection.left}:${selection.right}`
          );
        }
      ),
    });
    // A released channel's sound, and its capture, are gone.
    const { deactivate } = context.channels;
    context.channels.deactivate = mock((channelId: string) => {
      active.delete(`node:${channelId}`);
      deactivate(channelId);
    });
    return { active, calls, ended };
  }

  /** An `<audio>` element that records the device it was set to. */
  function fakeElements() {
    const elements: {
      sinkId: string;
      srcObject: unknown;
      reject: boolean;
      pause: ReturnType<typeof mock>;
    }[] = [];
    const createElement = () => {
      const element = {
        pause: mock(() => undefined),
        play: mock(() => Promise.resolve()),
        reject: false as boolean,
        setSinkId: mock((deviceId: string) => {
          if (element.reject) {
            return Promise.reject(new Error("Output not allowed"));
          }
          element.sinkId = deviceId;
          return Promise.resolve();
        }),
        sinkId: "",
        srcObject: null as unknown,
        volume: 1,
      };
      elements.push(element);
      return element as unknown as HTMLAudioElement;
    };
    return { createElement, elements };
  }

  function sinksWith({
    supported = true,
    createElement,
  }: {
    supported?: boolean;
    createElement: () => HTMLAudioElement;
  }): GetNodePlaybackOptions["deviceSinks"] {
    return (options) =>
      createNodeDeviceSinks({
        ...options,
        createElement,
        isSupported: () => supported,
        listOutputDeviceIds: async () => ["default", "usb", "hdmi"],
        watchDevices: () => () => undefined,
      });
  }

  /** Connects a lane's sound as AudioManager would, returning its sends. */
  function connectLane(context: PlaybackActionContext, nodeId: string) {
    const register = context.audio.setSoundOutputConnector as ReturnType<
      typeof mock<
        (soundId: string, connect: SoundOutputConnector | null) => void
      >
    >;
    const connect = register.mock.calls
      .filter(([soundId]) => soundId === soundOf(nodeId))
      .at(-1)?.[1];
    if (!connect) {
      throw new Error(`no output connector for ${nodeId}`);
    }
    const audio = new FakeAudioContext();
    const { fader, node } = createFakeFader(audio);
    const mainSources = new Set<unknown>();
    const connectMain = mock<MainOutputConnect>((source) => {
      mainSources.add(source);
      return () => {
        mainSources.delete(source);
      };
    });
    connect(node, false, connectMain);
    const laneOut = [...fader.connections][0] as FakeGainNode;
    const sends = () => [...laneOut.connections] as FakeGainNode[];
    return { audio, connectMain, mainSources, sends };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  test.each(["remove", "deactivate"] as const)(
    "%s while Go live requests permission stops the late real capture",
    async (cancel) => {
      insertNodeSession(wired([mic("mic"), speakers], ["mic>speakers"]));
      const capture = createDeviceCaptureHarness();
      try {
        const context = createTestContext();
        context.audio = capture.manager;
        const { activate, deactivate } = context.channels;
        context.channels.activate = (...args) => {
          const soundId = activate(...args);
          capture.manager.createSound(args[2], soundId);
          return soundId;
        };
        context.channels.deactivate = (channelId) => {
          const { soundId } = getPlaybackChannelRuntime(channelId);
          if (soundId) {
            capture.manager.cleanupSound(soundId);
          }
          deactivate(channelId);
        };
        const harness = createHarness({ context });
        await harness.playback.activate();
        const start = harness.playback.setPlaying("mic", true);
        const request = await capture.request();

        if (cancel === "remove") {
          await commit(harness, () => wired([speakers], []));
        } else {
          await harness.playback.deactivate();
        }
        const { stream, tracks } = capturedStream();
        request.resolve(stream);
        await start;

        expect(tracks.every((track) => track.readyState === "ended")).toBe(
          true
        );
        expect(capture.manager.hasSound(soundOf("mic"))).toBe(false);
        expect(capture.context.createMediaStreamSource).not.toHaveBeenCalled();
        expect(capture.connectMain).not.toHaveBeenCalled();
        expect(getPlaybackChannelRuntime(channelOf("mic"))).toMatchObject({
          error: null,
          isPlaying: false,
          soundId: null,
        });
        expect(context.reportError).not.toHaveBeenCalled();
      } finally {
        capture.restore();
      }
    }
  );

  test("Go live opens the device with its echo cancellation and selected channels", async () => {
    insertNodeSession(
      wired(
        [mic("mic", { channelSelection: { left: 1, right: 1 } }), speakers],
        ["mic>speakers"]
      )
    );
    const harness = createHarness();
    const { calls } = deviceEngine(harness.context);
    await harness.playback.activate();

    // Activation never opens a mic.
    expect(calls).toEqual([]);
    expect(getPlaybackChannelRuntime(channelOf("mic")).soundId).toBeNull();

    await harness.playback.setPlaying("mic", true);

    expect(calls).toEqual([
      `playDeviceSound ${soundOf("mic")} usb-mic {"echoCancellation":false} {"left":1,"right":1}`,
    ]);
    expect(harness.context.audio.playSound).not.toHaveBeenCalled();
    expect(getPlaybackChannel("node", channelOf("mic"))?.radio).toMatchObject({
      platformMetadata: { deviceId: "usb-mic", platform: "device-input" },
    });
  });

  test("Go live writes its strip once the capture has nodes, never before", async () => {
    const pan = {
      data: { pan: 0.5 },
      id: "pan",
      position: { x: 120, y: 200 },
      type: "pan",
    } as NodeInput;
    insertNodeSession(
      wired([mic("mic"), pan, speakers], ["mic>pan", "pan>speakers"])
    );
    const harness = createHarness();
    const { active } = deviceEngine(harness.context);
    const startCapture = harness.context.audio.playDeviceSound;
    // The permission prompt comes first; the capture's nodes after it.
    harness.context.audio.playDeviceSound = mock(
      async (...args: Parameters<typeof startCapture>) => {
        await Promise.resolve();
        return startCapture(...args);
      }
    );
    harness.context.audio.getPreFaderNode = mock((soundId: string) =>
      active.has(soundId) ? ({ soundId } as unknown as GainNode) : null
    );
    const writes: boolean[] = [];
    harness.context.audio.setPan = mock((soundId: string) => {
      writes.push(active.has(soundId));
    });
    await harness.playback.activate();

    await harness.playback.setPlaying("mic", true);

    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every(Boolean)).toBe(true);
  });

  test("a shared tab whose capture did not open is stopped, not left sharing", async () => {
    insertNodeSession(
      wired(
        [mic("tab", { capture: "display", deviceId: "display" }), speakers],
        ["tab>speakers"]
      )
    );
    const stopped: string[] = [];
    const track = {
      kind: "audio",
      readyState: "live",
      stop: () => stopped.push("audio"),
    };
    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
      getVideoTracks: () => [BROWSER_TAB_VIDEO],
    } as unknown as MediaStream;
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { mediaDevices: { getDisplayMedia: async () => stream } },
    });
    try {
      const harness = createHarness();
      Object.assign(harness.context.audio, {
        // The engine's start came back without an open capture.
        getDeviceSource: mock(() => ({
          channelCount: 2,
          cleanup: () => undefined,
          getDiagnostics: () => null,
          isActive: false,
        })),
        playDeviceSound: mock(async () => undefined),
      });
      await harness.playback.activate();

      await harness.playback.setPlaying("tab", true);

      expect(harness.context.audio.playDeviceSound).toHaveBeenCalledTimes(1);
      expect(stopped).toEqual(["audio"]);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: original,
      });
    }
  });

  test("a Go live that fails turns its Monitor back off", async () => {
    insertNodeSession(wired([mic("mic"), speakers], ["mic>speakers"]));
    const harness = createHarness();
    deviceEngine(harness.context);
    harness.context.audio.playDeviceSound = mock(() =>
      Promise.reject(new DOMException("denied", "NotAllowedError"))
    );
    const monitor = () => {
      const node = harness.store.state.graph?.nodes.find(
        (entry) => entry.id === "mic"
      );
      return node?.type === "deviceIn" ? node.data.strip.monitor : null;
    };
    await harness.playback.activate();

    const start = harness.playback.setPlaying("mic", true);
    expect(monitor()).toBe(true);
    await start;

    expect(getPlaybackChannelRuntime(channelOf("mic")).error).not.toBeNull();
    expect(monitor()).toBe(false);
  });

  test("a Go live that goes live keeps its Monitor on", async () => {
    insertNodeSession(wired([mic("mic"), speakers], ["mic>speakers"]));
    const harness = createHarness();
    deviceEngine(harness.context);
    await harness.playback.activate();

    await harness.playback.setPlaying("mic", true);

    const node = harness.store.state.graph?.nodes.find(
      (entry) => entry.id === "mic"
    );
    expect(node?.type === "deviceIn" && node.data.strip.monitor).toBe(true);
  });

  test.each([
    ["a closed share picker reports nothing", "NotAllowedError", null],
    [
      "a share without audio keeps its advice",
      null,
      "No audio was shared. Choose a tab and enable Share tab audio.",
    ],
  ] as const)(
    "Go live on a shared tab: %s",
    async (_name, domError, message) => {
      insertNodeSession(
        wired(
          [
            mic("tab", {
              capture: "display",
              deviceId: "display",
              deviceLabel: "Browser tab audio",
            }),
            speakers,
          ],
          ["tab>speakers"]
        )
      );
      const original = globalThis.navigator;
      const silent = {
        getAudioTracks: () => [],
        getTracks: () => [],
        getVideoTracks: () => [BROWSER_TAB_VIDEO],
      } as unknown as MediaStream;
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          mediaDevices: {
            getDisplayMedia: () =>
              domError
                ? Promise.reject(
                    new DOMException("Permission denied", domError)
                  )
                : Promise.resolve(silent),
          },
        },
      });
      try {
        const harness = createHarness();
        const { calls } = deviceEngine(harness.context);
        await harness.playback.activate();

        await harness.playback.setPlaying("tab", true);

        expect(calls).toEqual([]);
        if (message === null) {
          expect(harness.context.reportError).not.toHaveBeenCalled();
          expect(getPlaybackChannelRuntime(channelOf("tab")).error).toBeNull();
        } else {
          expect(harness.context.reportError).toHaveBeenCalledWith(
            expect.objectContaining({ userMessage: message })
          );
          expect(
            getPlaybackChannelRuntime(channelOf("tab")).error?.message
          ).toBe(message);
        }
      } finally {
        Object.defineProperty(globalThis, "navigator", {
          configurable: true,
          value: original,
        });
      }
    }
  );

  test("Go live on a shared tab reads as loading while the share picker is open", async () => {
    insertNodeSession(
      wired(
        [
          mic("tab", {
            capture: "display",
            deviceId: "display",
            deviceLabel: "Browser tab audio",
          }),
          speakers,
        ],
        ["tab>speakers"]
      )
    );
    const original = globalThis.navigator;
    const picker = Promise.withResolvers<MediaStream>();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { mediaDevices: { getDisplayMedia: () => picker.promise } },
    });
    try {
      const harness = createHarness();
      const { calls } = deviceEngine(harness.context);
      await harness.playback.activate();

      const start = harness.playback.setPlaying("tab", true);
      await settle();

      // Go live is disabled while loading, so it cannot open a second picker.
      expect(getPlaybackChannelRuntime(channelOf("tab")).isLoading).toBe(true);
      picker.resolve({
        getAudioTracks: () => [{ readyState: "live" }],
        getTracks: () => [],
        getVideoTracks: () => [BROWSER_TAB_VIDEO],
      } as unknown as MediaStream);
      await start;

      expect(calls).toHaveLength(1);
      expect(getPlaybackChannelRuntime(channelOf("tab"))).toMatchObject({
        isLoading: false,
        isPlaying: true,
      });
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: original,
      });
    }
  });

  test("Off ends a shared tab's capture; a mic stays open for an instant Go live", async () => {
    insertNodeSession(
      wired(
        [
          mic("tab", {
            capture: "display",
            deviceId: "display",
            deviceLabel: "Browser tab audio",
          }),
          mic("mic"),
          speakers,
        ],
        ["tab>speakers", "mic>speakers"]
      )
    );
    const original = globalThis.navigator;
    const getDisplayMedia = mock(() =>
      Promise.resolve({
        getAudioTracks: () => [{ readyState: "live" }],
        getTracks: () => [],
        getVideoTracks: () => [BROWSER_TAB_VIDEO],
      } as unknown as MediaStream)
    );
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { mediaDevices: { getDisplayMedia } },
    });
    try {
      const harness = createHarness();
      const { calls } = deviceEngine(harness.context);
      await harness.playback.activate();
      await harness.playback.setPlaying("tab", true);
      await harness.playback.setPlaying("mic", true);
      calls.length = 0;

      await harness.playback.setPlaying("tab", false);
      await harness.playback.setPlaying("mic", false);

      expect(calls).toEqual([`stop ${soundOf("tab")}`]);
      await harness.playback.setPlaying("tab", true);
      expect(getDisplayMedia).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: original,
      });
    }
  });

  test.each([0, 0.2])(
    "Go live seeds the saved fader %s before capture",
    async (volume) => {
      insertNodeSession(
        wired([mic("mic", { volume }), speakers], ["mic>speakers"])
      );
      const harness = createHarness();
      deviceEngine(harness.context);
      const startCapture = harness.context.audio.playDeviceSound;
      let volumeBeforeCapture: unknown = null;
      harness.context.audio.playDeviceSound = mock(
        (...args: Parameters<typeof startCapture>) => {
          volumeBeforeCapture = (
            harness.context.audioEngine.volume.setChannelVolume as ReturnType<
              typeof mock
            >
          ).mock.calls.at(-1);
          return startCapture(...args);
        }
      );
      await harness.playback.activate();
      await harness.playback.setPlaying("mic", true);
      expect(volumeBeforeCapture).toEqual([soundOf("mic"), volume]);
    }
  );

  test("Mute keeps the capture open, and Go live again only lifts its gain", async () => {
    insertNodeSession(wired([mic("mic"), speakers], ["mic>speakers"]));
    const harness = createHarness();
    const { calls } = deviceEngine(harness.context);
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("mic", true);

    await harness.playback.setPlaying("mic", false);
    expect(harness.context.audio.pauseSound).toHaveBeenCalledWith(
      soundOf("mic")
    );

    await harness.playback.setPlaying("mic", true);
    expect(
      calls.filter((call) => call.startsWith("playDeviceSound"))
    ).toHaveLength(1);
    expect(harness.context.audio.playSound).toHaveBeenCalledWith(
      soundOf("mic"),
      1
    );
  });

  test("Go live after an unplug opens the capture anew, not the dead one", async () => {
    insertNodeSession(wired([mic("mic"), speakers], ["mic>speakers"]));
    const harness = createHarness();
    const { calls, ended } = deviceEngine(harness.context);
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("mic", true);
    await harness.playback.setPlaying("mic", false);

    // Unplugged and back: the old capture's track has ended.
    ended.add(soundOf("mic"));
    await harness.playback.setPlaying("mic", true);

    expect(calls.filter((call) => !call.startsWith("setDevice"))).toEqual([
      `playDeviceSound ${soundOf("mic")} usb-mic {"echoCancellation":false} {"left":0,"right":1}`,
      `cleanup ${soundOf("mic")}`,
      `playDeviceSound ${soundOf("mic")} usb-mic {"echoCancellation":false} {"left":0,"right":1}`,
    ]);
  });

  test("echo cancellation starts a new capture with it on, still live", async () => {
    insertNodeSession(wired([mic("mic"), speakers], ["mic>speakers"]));
    const harness = createHarness();
    const { calls } = deviceEngine(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("mic", true);

    await commit(harness, (graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.type === "deviceIn"
          ? { ...node, data: { ...node.data, echoCancellation: true } }
          : node
      ),
    }));

    expect(calls.at(-1)).toBe(
      `playDeviceSound ${soundOf("mic")} usb-mic {"echoCancellation":true} {"left":0,"right":1}`
    );
  });

  test("new channels switch on the open capture", async () => {
    insertNodeSession(wired([mic("mic"), speakers], ["mic>speakers"]));
    const harness = createHarness();
    const { calls } = deviceEngine(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("mic", true);

    await commit(harness, (graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.type === "deviceIn"
          ? {
              ...node,
              data: { ...node.data, channelSelection: { left: 0, right: 0 } },
            }
          : node
      ),
    }));

    expect(calls.at(-1)).toBe(
      `setDeviceChannelSelection ${soundOf("mic")} 0:0`
    );
    expect(
      calls.filter((call) => call.startsWith("playDeviceSound"))
    ).toHaveLength(1);
  });

  test("a reload never goes live on its own: restore skips a device input", async () => {
    const graph = wired(
      [mic("mic"), station("a"), speakers],
      ["mic>speakers", "a>speakers"]
    );
    const input = compile(graph, { crossOriginIsolated: false }).lanes.get(
      "mic"
    );
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [],
      crossfadePosition: 0.5,
      graph,
      headphoneVolume: 1,
      id: "node",
      masterVolume: 1,
    });
    // The mic was live when the page went away.
    setPlaybackChannelRuntime(channelOf("mic"), () => ({ isPlaying: true }));
    const harness = createHarness();
    const { calls } = deviceEngine(harness.context);

    await harness.playback.activate();
    await harness.playback.whenSettled();

    expect(input?.radio.platformMetadata).toMatchObject({
      platform: "device-input",
    });
    expect(calls).toEqual([]);
    expect(harness.context.channels.activate).toHaveBeenCalledTimes(1);
    expect(getPlaybackChannelRuntime(channelOf("mic"))).toMatchObject({
      isPlaying: false,
      soundId: null,
    });
    expect(getPlaybackChannelRuntime(channelOf("a")).soundId).toBe(
      soundOf("a")
    );
  });

  test("a live input is no stream, so the stream budget leaves it alone", async () => {
    const ids = ["1", "2", "3", "4"];
    insertNodeSession(
      wired(
        [...ids.map((id) => station(id)), mic("mic"), speakers],
        [...ids.map((id) => `${id}>speakers`), "mic>speakers"]
      )
    );
    const harness = createHarness({ profile: "mobile" });
    instantStarts(harness.context);
    const { calls } = deviceEngine(harness.context);
    await harness.playback.activate();
    await Promise.all(ids.map((id) => harness.playback.setPlaying(id, true)));

    await harness.playback.setPlaying("mic", true);

    expect(calls[0]).toStartWith("playDeviceSound");
    expect(getPlaybackChannelRuntime(channelOf("mic")).error).toBeNull();
  });

  test("Play all plays the Stations and leaves a mic off; Pause all mutes it too", async () => {
    insertNodeSession(
      wired(
        [station("a"), mic("mic"), speakers],
        ["a>speakers", "mic>speakers"]
      )
    );
    const harness = createHarness();
    instantStarts(harness.context);
    const { calls } = deviceEngine(harness.context);
    await harness.playback.activate();

    await harness.playback.playAll();

    expect(harness.context.audio.playSound).toHaveBeenCalledWith(
      soundOf("a"),
      1
    );
    expect(calls).toEqual([]);

    await harness.playback.setPlaying("mic", true);
    harness.playback.pauseAll();
    expect(harness.context.audio.pauseSound).toHaveBeenCalledWith(
      soundOf("mic")
    );
  });

  test("volume and mute work on an Audio input like on a Station", async () => {
    insertNodeSession(wired([mic("mic"), speakers], ["mic>speakers"]));
    const harness = createHarness();
    await harness.playback.activate();

    harness.playback.setVolume("mic", 0.4);
    harness.playback.toggleMute("mic");
    await harness.playback.whenSettled();

    const node = harness.store.state.graph?.nodes.find(
      (entry) => entry.id === "mic"
    );
    expect(node?.data).toMatchObject({ muted: true, volume: 0.4 });
    expect(getPlaybackChannel("node", channelOf("mic"))).toMatchObject({
      muted: true,
      volume: 0.4,
    });
  });

  test("a Station cabled to Speakers and an Output device plays through both, each at its own level", async () => {
    insertNodeSession(
      nodeGraphSchema.parse({
        edges: [
          { ...cable("a", "speakers"), gain: 0.5 },
          { ...cable("a", "desk"), gain: 1.5 },
        ],
        nodes: [station("a"), output("desk", "usb"), speakers],
        version: 2,
      })
    );
    const { createElement, elements } = fakeElements();
    const statuses = new Store<NodeSinkStatuses>({});
    const harness = createHarness({
      deviceSinks: sinksWith({ createElement }),
      sinkStatuses: statuses,
    });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);

    const { audio, mainSources, sends } = connectLane(harness.context, "a");
    await settle();

    const [toSpeakers, toDesk] = sends();
    expect(mainSources.has(toSpeakers)).toBe(true);
    expect(mainSources.has(toDesk)).toBe(false);
    expect(toSpeakers?.gain.events.at(-1)).toMatchObject({ value: 0.5 });
    expect(toDesk?.gain.events.at(-1)).toMatchObject({ value: 1.5 });
    // The Output device's send feeds its sink, an <audio> set to the device.
    const [destination] = audio.destinations;
    const input = [...(toDesk?.connections ?? [])][0] as FakeGainNode;
    expect(input.connections.has(destination)).toBe(true);
    expect(elements[0]?.sinkId).toBe("usb");
    expect(statuses.state).toEqual({ desk: { state: "ok" } });
  });

  test("without setSinkId an Output device's cables play through Speakers", async () => {
    insertNodeSession(
      wired([station("a"), output("desk", "usb"), speakers], ["a>desk"])
    );
    const { createElement, elements } = fakeElements();
    const statuses = new Store<NodeSinkStatuses>({});
    const harness = createHarness({
      deviceSinks: sinksWith({ createElement, supported: false }),
      sinkStatuses: statuses,
    });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);

    const { mainSources, sends } = connectLane(harness.context, "a");

    expect(mainSources.has(sends()[0])).toBe(true);
    expect(elements).toHaveLength(0);
    expect(statuses.state).toEqual({ desk: { state: "unsupported" } });
  });

  test("a setSinkId rejection flips the Output device to its error and reroutes its sends to Speakers", async () => {
    insertNodeSession(
      wired([station("a"), output("desk", "usb"), speakers], ["a>desk"])
    );
    const { elements } = fakeElements();
    const statuses = new Store<NodeSinkStatuses>({});
    const createRejecting = () => {
      const element = fakeElements().createElement();
      (element as unknown as { reject: boolean }).reject = true;
      elements.push(element as never);
      return element;
    };
    const harness = createHarness({
      deviceSinks: sinksWith({ createElement: createRejecting }),
      sinkStatuses: statuses,
    });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);

    const { mainSources, sends } = connectLane(harness.context, "a");
    expect(mainSources.has(sends()[0])).toBe(false);
    await settle();

    expect(statuses.state).toEqual({
      desk: { message: "Output not allowed", state: "failed" },
    });
    expect(mainSources.has(sends()[0])).toBe(true);
  });

  test("Retry keeps failed output sends on Speakers until an explicit retry succeeds", async () => {
    insertNodeSession(
      wired([station("a"), output("desk", "usb"), speakers], ["a>desk"])
    );
    const { createElement, elements } = fakeElements();
    let rejection: string | null = "Output not allowed";
    const createOutput = () => {
      const element = createElement();
      element.setSinkId = mock((deviceId: string) =>
        rejection
          ? Promise.reject(new Error(rejection))
          : Promise.resolve().then(() => {
              (element as unknown as { sinkId: string }).sinkId = deviceId;
            })
      );
      return element;
    };
    const statuses = new Store<NodeSinkStatuses>({});
    const harness = createHarness({
      deviceSinks: sinksWith({ createElement: createOutput }),
      sinkStatuses: statuses,
    });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    const { mainSources, sends } = connectLane(harness.context, "a");
    await settle();

    expect(mainSources.has(sends()[0])).toBe(true);
    rejection = "Permission still blocked";
    harness.playback.retryOutputDevice("desk");
    await settle();
    expect(statuses.state.desk).toEqual({
      message: rejection,
      state: "failed",
    });
    expect(mainSources.has(sends()[0])).toBe(true);
    await settle();
    expect(elements).toHaveLength(2);

    rejection = null;
    harness.playback.retryOutputDevice("desk");
    await settle();
    expect(mainSources.has(sends()[0])).toBe(false);
    expect(elements[2]?.sinkId).toBe("usb");
    expect(statuses.state.desk).toEqual({ state: "ok" });
    await harness.playback.deactivate();
    harness.playback.retryOutputDevice("desk");
    expect(elements).toHaveLength(3);
  });

  test("deactivating during a pending output retry prevents its audio element from playing", async () => {
    insertNodeSession(
      wired([station("a"), output("desk", "usb"), speakers], ["a>desk"])
    );
    const { createElement, elements } = fakeElements();
    const attempt = Promise.withResolvers<void>();
    const fade = Promise.withResolvers<void>();
    const createOutput = () => {
      const element = createElement();
      element.setSinkId = mock(() =>
        elements.length === 1
          ? Promise.reject(new Error("Output not allowed"))
          : attempt.promise
      );
      return element;
    };
    const harness = createHarness({
      deviceSinks: sinksWith({ createElement: createOutput }),
      fadeOutSound: mock(() => fade.promise),
    });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    connectLane(harness.context, "a");
    await settle();
    harness.playback.retryOutputDevice("desk");
    const retried = elements[1] as unknown as HTMLAudioElement;
    const deactivation = harness.playback.deactivate();
    attempt.resolve();
    await settle();
    expect(retried.play).not.toHaveBeenCalled();
    fade.resolve();
    await deactivation;
    expect(retried.srcObject).toBeNull();
  });

  test("removing an Output device disposes its <audio> and takes its sends away", async () => {
    insertNodeSession(
      wired(
        [station("a"), output("desk", "usb"), speakers],
        ["a>desk", "a>speakers"]
      )
    );
    const { createElement, elements } = fakeElements();
    const statuses = new Store<NodeSinkStatuses>({});
    const harness = createHarness({
      deviceSinks: sinksWith({ createElement }),
      sinkStatuses: statuses,
    });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    const { audio, sends } = connectLane(harness.context, "a");
    await settle();
    expect(sends()).toHaveLength(2);

    await commit(harness, () => patch([station("a")]));

    expect(elements[0]?.pause).toHaveBeenCalled();
    expect(elements[0]?.srcObject).toBeNull();
    expect(audio.destinations[0]?.stopped).toEqual([true]);
    expect(statuses.state).toEqual({});
    // Its send fades out before it comes off the lane.
    await new Promise((resolve) => setTimeout(resolve, LANE_DROP_MS + 5));
    expect(sends()).toHaveLength(1);
  });
});

function youtubeTrack(id: string): Radio {
  return {
    id,
    name: `Video ${id}`,
    platformMetadata: {
      itemType: "video",
      platform: "youtube",
      url: `https://www.youtube.com/watch?v=${id}`,
      videoId: id,
    },
    streamUrl: `https://media.example/${id}.m4a`,
  };
}

function settleTrackResolution(
  resolution: {
    reject: (reason: Error) => void;
    resolve: (value: PlatformStreamResolution | null) => void;
  },
  outcome: "resolved" | "unresolved" | "rejected",
  trackId = "next"
): void {
  if (outcome === "rejected") {
    resolution.reject(new Error("selection resolution failed"));
    return;
  }
  resolution.resolve(
    outcome === "resolved"
      ? {
          streamFormat: "progressive",
          streamUrl: `https://media.example/${trackId}.m4a`,
        }
      : null
  );
}

function trackNode(
  id: string,
  radioOf: Radio | null = youtubeTrack(id),
  type: "platform" | "file" = "platform"
): NodeInput {
  return {
    data: { radio: radioOf },
    id,
    position: { x: 0, y: 0 },
    type,
  } as NodeInput;
}

const album: Radio = {
  id: "album",
  name: "An album",
  platformMetadata: {
    itemType: "album",
    platform: "bandcamp",
    tracks: [
      { name: "One", streamUrl: "https://media.example/one.mp3" },
      { name: "Two", streamUrl: "https://media.example/two.mp3" },
    ],
    url: "https://artist.bandcamp.com/album/an-album",
  },
  streamUrl: "https://media.example/one.mp3",
} as Radio;

const youtubePlaylist: Radio = {
  id: "playlist",
  name: "A playlist",
  platformMetadata: {
    itemType: "playlist",
    platform: "youtube",
    tracks: [
      {
        name: "One",
        streamUrl: "https://media.example/one.m4a",
        videoId: "one",
      },
      { name: "Two", streamUrl: "yt:two", videoId: "two" },
    ],
    url: "https://www.youtube.com/playlist?list=x",
  },
  streamUrl: "https://media.example/one.m4a",
};

/** The state listener a Track or File lane's sound was watched with. */
function laneWatcher(context: PlaybackActionContext, nodeId: string) {
  const calls = (
    context.channels.subscribeRuntime as ReturnType<typeof mock>
  ).mock.calls.filter(([, channelId]) => channelId === channelOf(nodeId));
  const options = calls.at(-1)?.[3] as
    | { onAudioState?: (state: AudioState) => boolean | undefined }
    | undefined;
  if (!options?.onAudioState) {
    throw new Error(`Lane ${nodeId} is not watched`);
  }
  return options.onAudioState;
}

function audioState(overrides: Partial<AudioState> = {}): AudioState {
  return {
    error: null,
    hasEnded: false,
    isBuffering: false,
    isLoading: false,
    isPlaying: false,
    volume: 1,
    ...overrides,
  };
}

describe("Node Playback: Track and File sources", () => {
  afterEach(() => {
    forgetLocalFileUrls();
  });

  test("a Track plays its platform stream through the managed engine", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();

    await harness.playback.setPlaying("video", true);

    expect(harness.context.channels.activate).toHaveBeenCalledWith(
      "node",
      channelOf("video"),
      expect.objectContaining({ id: "video" }),
      soundOf("video")
    );
    expect(harness.context.audio.playSound).toHaveBeenCalledWith(
      soundOf("video"),
      1
    );
    expect(getPlaybackChannelRuntime(channelOf("video"))).toMatchObject({
      error: null,
      isPlaying: true,
    });
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test("a current manual Track selection resolves, commits and plays", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const resolution = Promise.withResolvers<PlatformStreamResolution | null>();
    const harness = createHarness({ resolveStream: () => resolution.promise });
    instantStarts(harness.context);
    await harness.playback.activate();

    const selected = harness.playback.playTrack("video", "yt:next");
    resolution.resolve({
      streamFormat: "progressive",
      streamUrl: "https://media.example/next.m4a",
    });
    await selected;
    await harness.playback.whenSettled();

    expect(getPlaybackChannel("node", channelOf("video"))?.radio).toMatchObject(
      {
        streamUrl: "https://media.example/next.m4a",
      }
    );
    expect(getPlaybackChannelRuntime(channelOf("video")).isPlaying).toBe(true);
    expect(harness.context.audio.playSound).toHaveBeenCalledTimes(1);
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test("picking another track while one plays starts the new track once", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const harness = createHarness({
      resolveStream: async () => ({
        streamFormat: "progressive",
        streamUrl: "https://media.example/next.m4a",
      }),
    });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("video", true);

    await harness.playback.playTrack("video", "yt:next");
    await harness.playback.whenSettled();

    expect(getPlaybackChannel("node", channelOf("video"))?.radio).toMatchObject(
      { streamUrl: "https://media.example/next.m4a" }
    );
    expect(getPlaybackChannelRuntime(channelOf("video")).isPlaying).toBe(true);
    expect(harness.context.audio.playSound).toHaveBeenCalledTimes(2);
  });

  test.each(["resolved", "unresolved", "rejected"] as const)(
    "a manual Track selection %s after deactivation has no effect",
    async (outcome) => {
      insertNodeSession(patch([trackNode("video")]));
      const resolution =
        Promise.withResolvers<PlatformStreamResolution | null>();
      const harness = createHarness({
        resolveStream: () => resolution.promise,
      });
      instantStarts(harness.context);
      await harness.playback.activate();

      const selected = harness.playback.playTrack("video", "yt:next");
      await harness.playback.deactivate();
      const { graph: expectedGraph } = harness.store.state;
      settleTrackResolution(resolution, outcome);
      await selected;
      await harness.playback.whenSettled();

      expect(harness.store.state.graph).toBe(expectedGraph);
      expect(harness.context.audio.playSound).not.toHaveBeenCalled();
      expect(getPlaybackChannelRuntime(channelOf("video"))).toMatchObject({
        error: null,
        isPlaying: false,
        soundId: null,
      });
      expect(harness.context.reportError).not.toHaveBeenCalled();
    }
  );

  test.each(["resolved", "unresolved", "rejected"] as const)(
    "a manual Track selection %s after source replacement has no effect",
    async (outcome) => {
      insertNodeSession(patch([trackNode("video")]));
      const resolution =
        Promise.withResolvers<PlatformStreamResolution | null>();
      const harness = createHarness({
        resolveStream: () => resolution.promise,
      });
      instantStarts(harness.context);
      await harness.playback.activate();

      const selected = harness.playback.playTrack("video", "yt:next");
      commitNodeGraph(
        (graph) => setSourceRadio(graph, "video", youtubeTrack("replacement")),
        harness.store
      );
      const { graph: expectedGraph } = harness.store.state;
      settleTrackResolution(resolution, outcome);
      await selected;
      await harness.playback.whenSettled();

      expect(harness.store.state.graph).toBe(expectedGraph);
      expect(getPlaybackChannel("node", channelOf("video"))?.radio?.id).toBe(
        "replacement"
      );
      expect(harness.context.audio.playSound).not.toHaveBeenCalled();
      expect(getPlaybackChannelRuntime(channelOf("video")).error).toBeNull();
      expect(harness.context.reportError).not.toHaveBeenCalled();
    }
  );

  test("a manual Track selection from an earlier activation has no effect", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const resolution = Promise.withResolvers<PlatformStreamResolution | null>();
    const harness = createHarness({ resolveStream: () => resolution.promise });
    instantStarts(harness.context);
    await harness.playback.activate();

    const selected = harness.playback.playTrack("video", "yt:next");
    await harness.playback.deactivate();
    await harness.playback.activate();
    const { graph: expectedGraph } = harness.store.state;
    resolution.resolve({
      streamFormat: "progressive",
      streamUrl: "https://media.example/next.m4a",
    });
    await selected;
    await harness.playback.whenSettled();

    expect(harness.store.state.graph).toBe(expectedGraph);
    expect(harness.context.audio.playSound).not.toHaveBeenCalled();
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test.each(["resolved", "unresolved", "rejected"] as const)(
    "an older manual Track selection %s after the latest pick has no effect",
    async (outcome) => {
      insertNodeSession(patch([trackNode("video")]));
      const older = Promise.withResolvers<PlatformStreamResolution | null>();
      const latest = Promise.withResolvers<PlatformStreamResolution | null>();
      const harness = createHarness({
        resolveStream: (input) =>
          input.platform === "youtube" && input.videoId === "old"
            ? older.promise
            : latest.promise,
      });
      instantStarts(harness.context);
      await harness.playback.activate();

      const first = harness.playback.playTrack("video", "yt:old");
      const second = harness.playback.playTrack("video", "yt:latest");
      latest.resolve({
        streamFormat: "progressive",
        streamUrl: "https://media.example/latest.m4a",
      });
      await second;
      const { graph: expectedGraph } = harness.store.state;
      settleTrackResolution(older, outcome, "old");
      await first;
      await harness.playback.whenSettled();

      expect(harness.store.state.graph).toBe(expectedGraph);
      expect(
        getPlaybackChannel("node", channelOf("video"))?.radio
      ).toMatchObject({
        streamUrl: "https://media.example/latest.m4a",
      });
      expect(harness.context.audio.playSound).toHaveBeenCalledTimes(1);
      expect(getPlaybackChannelRuntime(channelOf("video")).error).toBeNull();
      expect(harness.context.reportError).not.toHaveBeenCalled();
    }
  );

  test("an older manual Track selection cannot commit while the latest pick resolves", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const older = Promise.withResolvers<PlatformStreamResolution | null>();
    const latest = Promise.withResolvers<PlatformStreamResolution | null>();
    const harness = createHarness({
      resolveStream: (input) =>
        input.platform === "youtube" && input.videoId === "old"
          ? older.promise
          : latest.promise,
    });
    instantStarts(harness.context);
    await harness.playback.activate();

    const first = harness.playback.playTrack("video", "yt:old");
    const second = harness.playback.playTrack("video", "yt:latest");
    const { graph: expectedGraph } = harness.store.state;
    older.resolve({
      streamFormat: "progressive",
      streamUrl: "https://media.example/old.m4a",
    });
    await first;
    expect(harness.store.state.graph).toBe(expectedGraph);
    expect(harness.context.audio.playSound).not.toHaveBeenCalled();

    latest.resolve({
      streamFormat: "progressive",
      streamUrl: "https://media.example/latest.m4a",
    });
    await second;
    await harness.playback.whenSettled();

    expect(getPlaybackChannel("node", channelOf("video"))?.radio).toMatchObject(
      {
        streamUrl: "https://media.example/latest.m4a",
      }
    );
    expect(harness.context.audio.playSound).toHaveBeenCalledTimes(1);
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test("a newer manual Track selection cancels an older fade waiter and still plays", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const older = Promise.withResolvers<PlatformStreamResolution | null>();
    const latest = Promise.withResolvers<PlatformStreamResolution | null>();
    const fade = Promise.withResolvers<void>();
    const fading = Promise.withResolvers<void>();
    const harness = createHarness({
      fadeOutSound: () => {
        fading.resolve();
        return fade.promise;
      },
      resolveStream: (input) =>
        input.platform === "youtube" && input.videoId === "old"
          ? older.promise
          : latest.promise,
    });
    instantStarts(harness.context);
    await harness.playback.activate();

    const first = harness.playback.playTrack("video", "yt:old");
    settleTrackResolution(older, "resolved", "old");
    await fading.promise;
    expect(harness.fadeOutSound).toHaveBeenCalledTimes(1);
    const second = harness.playback.playTrack("video", "yt:latest");
    fade.resolve();
    await first;
    expect(harness.context.audio.playSound).not.toHaveBeenCalled();

    settleTrackResolution(latest, "resolved", "latest");
    await second;
    await harness.playback.whenSettled();

    expect(getPlaybackChannel("node", channelOf("video"))?.radio).toMatchObject(
      {
        streamUrl: "https://media.example/latest.m4a",
      }
    );
    expect(getPlaybackChannelRuntime(channelOf("video")).isPlaying).toBe(true);
    expect(harness.context.audio.playSound).toHaveBeenCalledTimes(1);
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test("a manual Track selection after its source is removed has no effect", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const resolution = Promise.withResolvers<PlatformStreamResolution | null>();
    const harness = createHarness({ resolveStream: () => resolution.promise });
    instantStarts(harness.context);
    await harness.playback.activate();

    const selected = harness.playback.playTrack("video", "yt:next");
    await commit(harness, () => patch([]));
    const { graph: expectedGraph } = harness.store.state;
    settleTrackResolution(resolution, "resolved");
    await selected;
    await harness.playback.whenSettled();

    expect(harness.store.state.graph).toBe(expectedGraph);
    expect(harness.context.audio.playSound).not.toHaveBeenCalled();
    expect(getPlaybackChannelRuntime(channelOf("video")).soundId).toBeNull();
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test("a manual Track selection keeps a fader edit made while it resolves", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const resolution = Promise.withResolvers<PlatformStreamResolution | null>();
    const harness = createHarness({ resolveStream: () => resolution.promise });
    instantStarts(harness.context);
    await harness.playback.activate();

    const selected = harness.playback.playTrack("video", "yt:next");
    harness.playback.setVolume("video", 0.25);
    settleTrackResolution(resolution, "resolved");
    await selected;
    await harness.playback.whenSettled();

    expect(getPlaybackChannel("node", channelOf("video"))).toMatchObject({
      radio: { streamUrl: "https://media.example/next.m4a" },
      volume: 0.25,
    });
    expect(harness.context.audio.playSound).toHaveBeenCalledWith(
      soundOf("video"),
      0.25
    );
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test.each(["unresolved", "rejected"] as const)(
    "a current manual Track selection that is %s reports its failure",
    async (outcome) => {
      insertNodeSession(patch([trackNode("video")]));
      const resolution =
        Promise.withResolvers<PlatformStreamResolution | null>();
      const harness = createHarness({
        resolveStream: () => resolution.promise,
      });
      await harness.playback.activate();

      const selected = harness.playback.playTrack("video", "yt:next");
      settleTrackResolution(resolution, outcome);
      await selected;

      expect(getPlaybackChannelRuntime(channelOf("video")).error?.message).toBe(
        "Couldn't load this track"
      );
      expect(harness.context.reportError).toHaveBeenCalledTimes(1);
      expect(harness.context.audio.playSound).not.toHaveBeenCalled();
    }
  );

  test.each([
    ["youtube", youtubeTrack("video")],
    ["bandcamp", album],
    [
      "soundcloud",
      {
        id: "soundcloud",
        name: "SoundCloud track",
        platformMetadata: {
          itemType: "track",
          platform: "soundcloud",
          url: "https://soundcloud.com/artist/track",
        },
        streamUrl: "https://media.example/expired.mp3",
      } as Radio,
    ],
  ] as const)(
    "a restored expired %s URL renews once before replay",
    async (_platform, source) => {
      insertNodeSession(patch([trackNode("video", source)]));
      const resolveStream = mock(async () => ({
        streamFormat: "progressive" as const,
        streamUrl: "https://media.example/renewed.mp3",
      }));
      const harness = createHarness({ resolveStream });
      instantStarts(harness.context);
      (
        harness.context.audio.playSound as ReturnType<typeof mock>
      ).mockImplementationOnce(() =>
        Promise.reject(new Error("Expired media URL: 403"))
      );
      harness.context.audio.getTrackProgress = mock(() => ({
        duration: 120,
        position: 42,
      }));
      await harness.playback.activate();
      harness.playback.setVolume("video", 0.2);
      harness.playback.flush();

      await harness.playback.setPlaying("video", true);

      expect(resolveStream).toHaveBeenCalledTimes(1);
      expect(resolveStream).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: source.platformMetadata?.platform,
          reason: "stream-refresh",
        })
      );
      expect(
        harness.context.audioEngine.playback.refreshStreamUrl
      ).toHaveBeenCalledWith(
        soundOf("video"),
        "https://media.example/renewed.mp3",
        42,
        "progressive"
      );
      expect(harness.context.audio.playSound).toHaveBeenCalledTimes(2);
      expect(harness.context.audio.playSound).toHaveBeenLastCalledWith(
        soundOf("video"),
        0.2
      );
      expect(getPlaybackChannelRuntime(channelOf("video"))).toMatchObject({
        error: null,
        isPlaying: true,
      });
      expect(harness.context.reportError).not.toHaveBeenCalled();
    }
  );

  test.each(["unresolved", "rejected", "invalid", "retry-failed"] as const)(
    "an initial renewal is bounded and reports %s",
    async (outcome) => {
      insertNodeSession(patch([trackNode("video")]));
      const resolveStream = mock(() => {
        if (outcome === "rejected") {
          return Promise.reject(new Error("Platform unavailable"));
        }
        return Promise.resolve(
          outcome === "unresolved"
            ? null
            : {
                streamFormat: "progressive" as const,
                streamUrl:
                  outcome === "invalid"
                    ? "javascript:bad()"
                    : "https://media.example/renewed.m4a",
              }
        );
      });
      const harness = createHarness({ resolveStream });
      harness.context.audio.playSound = mock(() =>
        Promise.reject(new Error("Expired media URL: 403"))
      );
      await harness.playback.activate();

      await harness.playback.setPlaying("video", true);

      expect(resolveStream).toHaveBeenCalledTimes(1);
      expect(harness.context.audio.playSound).toHaveBeenCalledTimes(
        outcome === "retry-failed" ? 2 : 1
      );
      expect(
        harness.context.audioEngine.playback.refreshStreamUrl
      ).toHaveBeenCalledTimes(outcome === "retry-failed" ? 1 : 0);
      expect(getPlaybackChannelRuntime(channelOf("video")).error?.message).toBe(
        "Failed to refresh YouTube stream - please reload"
      );
      expect(harness.context.reportError).toHaveBeenCalledTimes(1);
    }
  );

  test.each([
    "source-pause",
    "all-pause",
    "deactivate",
    "replace",
    "manual-pick",
  ] as const)("an initial renewal cannot resume after %s", async (action) => {
    insertNodeSession(patch([trackNode("video")]));
    const renewal = Promise.withResolvers<{
      streamFormat: "progressive";
      streamUrl: string;
    }>();
    const resolving = Promise.withResolvers<void>();
    const resolveStream = mock(() => {
      resolving.resolve();
      return renewal.promise;
    });
    const harness = createHarness({ resolveStream });
    instantStarts(harness.context);
    (
      harness.context.audio.playSound as ReturnType<typeof mock>
    ).mockImplementationOnce(() =>
      Promise.reject(new Error("Expired media URL: 403"))
    );
    await harness.playback.activate();
    const starting = harness.playback.setPlaying("video", true);
    await resolving.promise;

    if (action === "source-pause") {
      await harness.playback.setPlaying("video", false);
    } else if (action === "all-pause") {
      harness.playback.pauseAll();
    } else if (action === "deactivate") {
      await harness.playback.deactivate();
    } else if (action === "replace") {
      await commit(harness, (graph) =>
        setSourceRadio(graph, "video", youtubeTrack("other"))
      );
    } else {
      await harness.playback.playTrack(
        "video",
        "https://media.example/selected.m4a"
      );
    }
    renewal.resolve({
      streamFormat: "progressive",
      streamUrl: "https://media.example/stale.m4a",
    });
    await starting;
    await harness.playback.whenSettled();

    expect(
      harness.context.audioEngine.playback.refreshStreamUrl
    ).not.toHaveBeenCalled();
    expect(harness.context.reportError).not.toHaveBeenCalled();
    expect(harness.context.audio.playSound).toHaveBeenCalledTimes(
      action === "manual-pick" ? 2 : 1
    );
    if (action === "replace" || action === "manual-pick") {
      expect(
        getPlaybackChannel("node", channelOf("video"))?.radio?.streamUrl
      ).toBe(
        action === "replace"
          ? "https://media.example/other.m4a"
          : "https://media.example/selected.m4a"
      );
    } else {
      expect(getPlaybackChannelRuntime(channelOf("video")).isPlaying).toBe(
        false
      );
    }
  });

  test("an autoplay rejection does not renew a platform URL", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const resolveStream = mock(async () => null);
    const harness = createHarness({ resolveStream });
    harness.context.audio.playSound = mock(() =>
      Promise.reject(new DOMException("Gesture required", "NotAllowedError"))
    );
    await harness.playback.activate();

    await harness.playback.setPlaying("video", true);

    expect(resolveStream).not.toHaveBeenCalled();
    expect(
      harness.context.audioEngine.playback.refreshStreamUrl
    ).not.toHaveBeenCalled();
    expect(harness.context.reportError).toHaveBeenCalledTimes(1);
  });

  test("pausing a pending YouTube start suppresses its later abort", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const resolveStream = mock(async () => null);
    const harness = createHarness({ resolveStream });
    let rejectStart: (error: Error) => void = () => undefined;
    harness.context.audio.playSound = mock(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStart = reject;
        })
    );
    await harness.playback.activate();

    const starting = harness.playback.setPlaying("video", true);
    await harness.playback.setPlaying("video", false);
    rejectStart(new DOMException("Load aborted", "AbortError"));
    await starting;

    expect(getPlaybackChannelRuntime(channelOf("video"))).toMatchObject({
      error: null,
      isLoading: false,
      isPlaying: false,
    });
    expect(resolveStream).not.toHaveBeenCalled();
    expect(harness.context.reportError).not.toHaveBeenCalled();
  });

  test("an expired YouTube stream is renewed and resumes where it stopped", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const resolveStream = mock(async () => ({
      streamFormat: "progressive" as const,
      streamUrl: "https://media.example/renewed.m4a",
    }));
    const harness = createHarness({ resolveStream });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("video", true);

    setPlaybackChannelRuntime(channelOf("video"), () => ({
      error: { code: "STREAM_INTERRUPTED", message: "403" } as never,
    }));
    laneWatcher(
      harness.context,
      "video"
    )(
      audioState({
        error: {
          code: "STREAM_INTERRUPTED",
          id: "e1",
          message: "Stream interrupted at 42s",
          position: 42,
          timestamp: Date.now(),
        },
      })
    );
    await harness.playback.whenSettled();

    expect(resolveStream).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "stream-refresh", videoId: "video" })
    );
    expect(
      harness.context.audioEngine.playback.refreshStreamUrl
    ).toHaveBeenCalledWith(
      soundOf("video"),
      "https://media.example/renewed.m4a",
      42,
      "progressive"
    );
    expect(getPlaybackChannelRuntime(channelOf("video")).error).toBeNull();
  });

  test.each(["recovered", "failed", "aborted", "resolution-rejected"] as const)(
    "a YouTube start that %s publishes only the final error and sends terminal failures through the SDK",
    async (outcome) => {
      insertNodeSession(patch([trackNode("video")]));
      const harness = createHarness({
        resolveStream: async (input) => {
          if (outcome === "resolution-rejected") {
            return await resolveDjPlatformStreamUrl(input, {
              getYouTubeClient: () => {
                throw new Error("YouTube provider unavailable");
              },
            });
          }
          return outcome === "recovered"
            ? {
                streamFormat: "progressive",
                streamUrl: "https://media.example/renewed.m4a",
              }
            : null;
        },
      });
      instantStarts(harness.context);
      await harness.playback.activate();
      harness.context.reportError = capturePlaybackActionError;
      const events: Sentry.Event[] = [];
      init({
        ...makeSentryOptions({
          dsn: "http://key@localhost/42",
          environment: "test",
          release: "radio@test",
        }),
        transport: () => ({
          flush: () => Promise.resolve(true),
          send: (envelope: Sentry.Envelope) => {
            for (const [header, event] of envelope[1]) {
              if (header.type === "event") {
                events.push(event as Sentry.Event);
              }
            }
            return Promise.resolve({ statusCode: 200 });
          },
        }),
      });
      let publish = (_state: AudioState) => undefined;
      harness.context.audio.subscribe = mock((_id, listener) => {
        publish = listener;
        return () => undefined;
      });
      const manager = spyOn(AudioManager, "getInstance").mockReturnValue(
        harness.context.audio
      );
      try {
        subscribeChannelRuntime("node", channelOf("video"), soundOf("video"), {
          onAudioState: laneWatcher(harness.context, "video"),
        });
        const callbacks = createPlaybackSourceCallbacks({
          instance: {
            buffering: false,
            loading: true,
            playing: true,
            radio: getPlaybackChannel("node", channelOf("video"))?.radio,
            volume: 1,
          } as SoundInstance,
          notifyListeners: (_id, state) => publish(state),
          soundId: soundOf("video"),
        });
        (
          harness.context.audio.playSound as ReturnType<typeof mock>
        ).mockImplementationOnce(() => {
          const failure =
            outcome === "aborted"
              ? new DOMException("Playback unexpectedly aborted", "AbortError")
              : new Error("Expired YouTube stream");
          callbacks.onError?.(failure);
          expect(
            getPlaybackChannelRuntime(channelOf("video")).error
          ).toBeNull();
          return Promise.reject(failure);
        });

        await harness.playback.setPlaying("video", true);
        await harness.playback.whenSettled();
        await flush(2000);

        expect(events).toHaveLength(outcome === "recovered" ? 0 : 1);
        expect(getPlaybackChannelRuntime(channelOf("video"))).toMatchObject({
          error: outcome === "recovered" ? null : expect.any(Object),
          isBuffering: false,
          isLoading: false,
          isPlaying: outcome === "recovered",
        });
        if (outcome !== "recovered") {
          expect(events[0]?.tags).toMatchObject({
            error_code: "PLAY_ERROR",
            mode: "node",
            operation: "playback",
          });
          if (outcome === "aborted") {
            expect(events[0]?.exception?.values?.at(-1)).toMatchObject({
              type: "AbortError",
              value: "Playback unexpectedly aborted",
            });
          }
          if (outcome === "resolution-rejected") {
            expect(events[0]?.exception?.values?.at(-1)).toMatchObject({
              type: "Error",
              value: "YouTube provider unavailable",
            });
          }
        }
      } finally {
        manager.mockRestore();
        await close();
        Sentry.getCurrentScope().setClient(undefined);
      }
    }
  );

  test.each(["success", "unresolved", "failed", "load-failed"] as const)(
    "production Node callbacks defer interruption reporting until renewal is %s",
    async (outcome) => {
      insertNodeSession(patch([trackNode("video")]));
      const renewal = Promise.withResolvers<PlatformStreamResolution | null>();
      const harness = createHarness({
        resolveStream: mock(() => renewal.promise),
      });
      instantStarts(harness.context);
      await harness.playback.activate();
      await harness.playback.setPlaying("video", true);
      harness.context.reportError = capturePlaybackActionError;
      const enabled = spyOn(Sentry, "isEnabled").mockReturnValue(true);
      const capture = spyOn(Sentry, "captureException").mockReturnValue(
        "1234567890abcdef1234567890abcdef"
      );
      let publish = (_state: AudioState) => undefined;
      harness.context.audio.subscribe = mock((_soundId, listener) => {
        publish = listener;
        return () => undefined;
      });
      const manager = spyOn(AudioManager, "getInstance").mockReturnValue(
        harness.context.audio
      );
      try {
        if (outcome === "load-failed") {
          // Exercise the real refresh callback and rejection together.
          const { AudioManager: RefreshManager } = await import(
            `./audio/manager/audio-manager.ts?${"unmocked"}`
          );
          harness.context.audioEngine.playback.refreshStreamUrl = mock(
            (
              soundId: string,
              url: string,
              position?: number,
              streamFormat?: Radio["streamFormat"]
            ) =>
              RefreshManager.prototype.refreshStreamUrl.call(
                {
                  notifyListeners: (_id: string, state: AudioState) =>
                    publish(state),
                  sounds: new Map([
                    [
                      soundId,
                      {
                        buffering: false,
                        playbackSource: {
                          refreshUrl: () =>
                            Promise.reject(new Error("Renewed stream failed")),
                        },
                        radio: getPlaybackChannel("node", channelOf("video"))
                          ?.radio,
                        volume: 1,
                      },
                    ],
                  ]),
                } as unknown as ReturnType<typeof RefreshManager.getInstance>,
                soundId,
                url,
                position,
                streamFormat
              )
          );
        }
        subscribeChannelRuntime("node", channelOf("video"), soundOf("video"), {
          onAudioState: laneWatcher(harness.context, "video"),
        });
        const callbacks = createPlaybackSourceCallbacks({
          instance: {
            buffering: false,
            loading: false,
            playing: true,
            radio: getPlaybackChannel("node", channelOf("video"))?.radio,
            volume: 1,
          } as SoundInstance,
          notifyListeners: (_soundId, state) => publish(state),
          soundId: soundOf("video"),
        });
        const expired = new Error("Expired platform URL");
        callbacks.onStreamError?.(42, expired);
        callbacks.onError?.(expired, true);
        expect(capture).not.toHaveBeenCalled();
        if (outcome === "failed") {
          renewal.reject(new Error("Renewal unavailable"));
        } else {
          renewal.resolve(
            outcome === "success" || outcome === "load-failed"
              ? {
                  streamFormat: "progressive",
                  streamUrl: "https://media.example/renewed.m4a",
                }
              : null
          );
        }
        await harness.playback.whenSettled();
        expect(capture).toHaveBeenCalledTimes(outcome === "success" ? 0 : 1);
        callbacks.onError?.(new Error("Unrelated source failure"));
        expect(capture).toHaveBeenCalledTimes(outcome === "success" ? 1 : 2);
      } finally {
        capture.mockRestore();
        enabled.mockRestore();
        manager.mockRestore();
      }
    }
  );

  test("a sound repeating its interruption renews its stream once", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const renewal = Promise.withResolvers<PlatformStreamResolution | null>();
    const resolveStream = mock(() => renewal.promise);
    const harness = createHarness({ resolveStream });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("video", true);
    const interrupted = audioState({
      error: {
        code: "STREAM_INTERRUPTED",
        id: "e1",
        message: "expired",
        position: 42,
        timestamp: Date.now(),
      },
    });

    const watch = laneWatcher(harness.context, "video");
    watch(interrupted);
    watch({ ...interrupted, isBuffering: true });
    renewal.resolve({
      streamFormat: "progressive",
      streamUrl: "https://media.example/renewed.m4a",
    });
    await harness.playback.whenSettled();

    expect(resolveStream).toHaveBeenCalledTimes(1);
    expect(
      harness.context.audioEngine.playback.refreshStreamUrl
    ).toHaveBeenCalledTimes(1);

    // A later interruption, once that renewal is done, renews again.
    watch(interrupted);
    await harness.playback.whenSettled();
    expect(resolveStream).toHaveBeenCalledTimes(2);
  });

  test("a stream the platform can't renew says so on the lane", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const harness = createHarness({ resolveStream: mock(async () => null) });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("video", true);

    laneWatcher(
      harness.context,
      "video"
    )(
      audioState({
        error: {
          code: "STREAM_INTERRUPTED",
          id: "e1",
          message: "expired",
          position: 3,
          timestamp: Date.now(),
        },
      })
    );
    await harness.playback.whenSettled();

    expect(
      harness.context.audioEngine.playback.refreshStreamUrl
    ).not.toHaveBeenCalled();
    expect(getPlaybackChannelRuntime(channelOf("video")).error?.message).toBe(
      "Failed to refresh YouTube stream - please reload"
    );
  });

  test("a refresh for a track the Track has since left never lands on the new one", async () => {
    insertNodeSession(patch([trackNode("video")]));
    let resolveRenewal: (value: {
      streamFormat: "progressive";
      streamUrl: string;
    }) => void = () => undefined;
    const resolveStream = mock(
      () =>
        new Promise<{ streamFormat: "progressive"; streamUrl: string }>(
          (resolve) => {
            resolveRenewal = resolve;
          }
        )
    );
    const harness = createHarness({ resolveStream });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("video", true);

    laneWatcher(
      harness.context,
      "video"
    )(
      audioState({
        error: {
          code: "STREAM_INTERRUPTED",
          id: "e1",
          message: "expired",
          position: 42,
          timestamp: Date.now(),
        },
      })
    );
    // Another track goes into the Track while the old one renews; its
    // sound keeps the lane's sound id.
    commitNodeGraph(
      (graph) => setSourceRadio(graph, "video", youtubeTrack("other")),
      harness.store
    );
    harness.playback.flush();
    // The old lane fades out and the new one takes over.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getPlaybackChannel("node", channelOf("video"))?.radio).toMatchObject(
      { id: "other" }
    );
    resolveRenewal({
      streamFormat: "progressive",
      streamUrl: "https://media.example/renewed-old.m4a",
    });
    await harness.playback.whenSettled();

    expect(
      harness.context.audioEngine.playback.refreshStreamUrl
    ).not.toHaveBeenCalled();
  });

  test.each(["source", "all"] as const)(
    "an interrupted stream's renewal cannot resume it after a %s pause",
    async (pause) => {
      insertNodeSession(patch([trackNode("video")]));
      const renewal = Promise.withResolvers<{
        streamFormat: "progressive";
        streamUrl: string;
      }>();
      const harness = createHarness({
        resolveStream: mock(() => renewal.promise),
      });
      instantStarts(harness.context);
      await harness.playback.activate();
      await harness.playback.setPlaying("video", true);

      laneWatcher(
        harness.context,
        "video"
      )(
        audioState({
          error: {
            code: "STREAM_INTERRUPTED",
            id: "e1",
            message: "expired",
            position: 42,
            timestamp: Date.now(),
          },
        })
      );
      if (pause === "all") {
        harness.playback.pauseAll();
      } else {
        await harness.playback.setPlaying("video", false);
      }
      renewal.resolve({
        streamFormat: "progressive",
        streamUrl: "https://media.example/renewed.m4a",
      });
      await harness.playback.whenSettled();

      expect(
        harness.context.audioEngine.playback.refreshStreamUrl
      ).not.toHaveBeenCalled();
      expect(getPlaybackChannelRuntime(channelOf("video")).isPlaying).toBe(
        false
      );
    }
  );

  test("an interrupted stream renewing its URL keeps its stream budget slot", async () => {
    insertNodeSession(
      patch([
        station("a"),
        station("b"),
        trackNode("t1"),
        trackNode("video"),
        trackNode("t2"),
      ])
    );
    const renewal = Promise.withResolvers<{
      streamFormat: "progressive";
      streamUrl: string;
    }>();
    const harness = createHarness({
      profile: "mobile",
      resolveStream: mock(() => renewal.promise),
    });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    await harness.playback.setPlaying("b", true);
    await harness.playback.setPlaying("t1", true);
    await harness.playback.setPlaying("video", true);

    setPlaybackChannelRuntime(channelOf("video"), () => ({
      isLoading: false,
      isPlaying: false,
    }));
    laneWatcher(
      harness.context,
      "video"
    )(
      audioState({
        error: {
          code: "STREAM_INTERRUPTED",
          id: "e1",
          message: "expired",
          position: 42,
          timestamp: Date.now(),
        },
      })
    );
    await harness.playback.setPlaying("t2", true);

    expect(getPlaybackChannelRuntime(channelOf("t2"))).toMatchObject({
      error: {
        message:
          "Up to 4 streams can play at once here. Pause one to start this.",
      },
      isPlaying: false,
    });
    renewal.resolve({
      streamFormat: "progressive",
      streamUrl: "https://media.example/renewed.m4a",
    });
    await harness.playback.whenSettled();
  });

  test("a replaced track's fading sound ending never advances its replacement", async () => {
    insertNodeSession(patch([trackNode("album", album)]));
    const fade = Promise.withResolvers<void>();
    const harness = createHarness({ fadeOutSound: () => fade.promise });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("album", true);
    const oldWatcher = laneWatcher(harness.context, "album");

    const replacement = {
      id: "other-album",
      name: "Another album",
      platformMetadata: {
        itemType: "album",
        platform: "bandcamp",
        tracks: [
          { name: "A", streamUrl: "https://media.example/a.mp3" },
          { name: "B", streamUrl: "https://media.example/b.mp3" },
        ],
        url: "https://artist.bandcamp.com/album/another-album",
      },
      streamUrl: "https://media.example/a.mp3",
    } as Radio;
    commitNodeGraph(
      (graph) => setSourceRadio(graph, "album", replacement),
      harness.store
    );
    harness.playback.flush();
    // The old sound ends while it fades out.
    setPlaybackChannelRuntime(channelOf("album"), () => ({
      isPlaying: false,
    }));
    oldWatcher(audioState({ hasEnded: true }));
    fade.resolve();
    await harness.playback.whenSettled();

    const node = harness.store.state.graph?.nodes.find(
      (entry) => entry.id === "album"
    );
    expect(node?.data).toMatchObject({
      radio: { streamUrl: "https://media.example/a.mp3" },
    });
  });

  test("an album moves to its next track at the end of one, and plays it", async () => {
    insertNodeSession(patch([trackNode("album", album)]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("album", true);

    setPlaybackChannelRuntime(channelOf("album"), () => ({
      isPlaying: false,
    }));
    laneWatcher(harness.context, "album")(audioState({ hasEnded: true }));
    await harness.playback.whenSettled();

    const node = harness.store.state.graph?.nodes.find(
      (entry) => entry.id === "album"
    );
    expect(node?.data).toMatchObject({
      radio: { streamUrl: "https://media.example/two.mp3" },
    });
    expect(getPlaybackChannel("node", channelOf("album"))?.radio).toMatchObject(
      { streamUrl: "https://media.example/two.mp3" }
    );
    expect(getPlaybackChannelRuntime(channelOf("album")).isPlaying).toBe(true);
    expect(harness.context.audio.playSound).toHaveBeenCalledTimes(2);

    // The last track just ends.
    setPlaybackChannelRuntime(channelOf("album"), () => ({
      isPlaying: false,
    }));
    laneWatcher(harness.context, "album")(audioState({ hasEnded: true }));
    await harness.playback.whenSettled();
    expect(harness.context.audio.playSound).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["source", "resolved"],
    ["all", "resolved"],
    ["none", "resolved"],
    ["source", "rejected"],
    ["all", "rejected"],
  ] as const)(
    "next-track resolution respects %s pause (%s)",
    async (pause, outcome) => {
      insertNodeSession(patch([trackNode("playlist", youtubePlaylist)]));
      const renewal = Promise.withResolvers<{
        streamFormat: "progressive";
        streamUrl: string;
      }>();
      const resolveStream = mock(() => renewal.promise);
      const harness = createHarness({ resolveStream });
      instantStarts(harness.context);
      await harness.playback.activate();
      await harness.playback.setPlaying("playlist", true);

      setPlaybackChannelRuntime(channelOf("playlist"), () => ({
        isPlaying: false,
      }));
      laneWatcher(harness.context, "playlist")(audioState({ hasEnded: true }));
      expect(resolveStream).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "playlist-next", videoId: "two" })
      );
      const endedGraph = harness.store.state.graph;
      if (pause === "all") {
        harness.playback.pauseAll();
      } else if (pause === "source") {
        await harness.playback.setPlaying("playlist", false);
      }
      if (outcome === "rejected") {
        renewal.reject(new Error("failure after pause"));
      } else {
        renewal.resolve({
          streamFormat: "progressive",
          streamUrl: "https://media.example/two.m4a",
        });
      }
      await harness.playback.whenSettled();

      if (pause === "none") {
        expect(
          getPlaybackChannel("node", channelOf("playlist"))?.radio
        ).toMatchObject({ streamUrl: "https://media.example/two.m4a" });
        expect(harness.context.audio.playSound).toHaveBeenCalledTimes(2);
        expect(getPlaybackChannelRuntime(channelOf("playlist")).isPlaying).toBe(
          true
        );
      } else {
        expect(harness.store.state.graph).toBe(endedGraph);
        expect(
          getPlaybackChannel("node", channelOf("playlist"))?.radio
        ).toMatchObject({ streamUrl: youtubePlaylist.streamUrl });
        expect(harness.context.audio.playSound).toHaveBeenCalledTimes(1);
        expect(getPlaybackChannelRuntime(channelOf("playlist")).isPlaying).toBe(
          false
        );
      }
      expect(harness.context.reportError).not.toHaveBeenCalled();
    }
  );

  test("a third playing Track past the mobile budget is refused with its message", async () => {
    insertNodeSession(
      patch([
        station("a"),
        station("b"),
        trackNode("t1"),
        trackNode("t2"),
        trackNode("t3"),
      ])
    );
    const harness = createHarness({ profile: "mobile" });
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    await harness.playback.setPlaying("b", true);
    await harness.playback.setPlaying("t1", true);
    await harness.playback.setPlaying("t2", true);

    await harness.playback.setPlaying("t3", true);

    expect(getPlaybackChannelRuntime(channelOf("t3"))).toMatchObject({
      error: {
        message:
          "Up to 4 streams can play at once here. Pause one to start this.",
      },
      isPlaying: false,
    });
  });

  test("a local file plays in its page; after a reload its File has no lane", async () => {
    const picked = localFileRadio("file", {
      displayName: "Demo",
      duration: 10,
      fileName: "demo.mp3",
      fileSize: 100,
      mimeType: "audio/mpeg",
      objectUrl: "blob:https://radio.example/demo",
    });
    keepLocalFileUrl(picked.streamUrl);
    insertNodeSession(patch([trackNode("file", null, "file")]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();

    await commit(harness, (graph) => setSourceRadio(graph, "file", picked));
    // Restore never prepares a local file; its sound is made on play.
    expect(getPlaybackChannelRuntime(channelOf("file")).soundId).toBeNull();
    await harness.playback.setPlaying("file", true);
    expect(getPlaybackChannelRuntime(channelOf("file")).isPlaying).toBe(true);
    expect(() => laneWatcher(harness.context, "file")).not.toThrow();

    // A reload: the object URL died with the page.
    const saved = getPlaybackSession("node")?.graph;
    await harness.playback.deactivate();
    forgetLocalFileUrls();
    resetAllPlaybackRuntime();
    await resetCollections();
    insertSettings();
    insertNodeSession(saved ?? undefined);
    const reloaded = createHarness();
    await reloaded.playback.activate();

    expect(
      reloaded.store.state.graph?.nodes.find((node) => node.id === "file")
    ).toMatchObject({ data: { radio: { name: "Demo" } }, type: "file" });
    expect(getPlaybackSession("node")?.channels).toEqual([]);
  });

  test("a local file URL survives a patch reset until its removed sound finishes fading", async () => {
    const objectUrl = URL.createObjectURL(new File(["audio"], "demo.mp3"));
    const revokeUrl = spyOn(URL, "revokeObjectURL");
    const picked = localFileRadio("file", {
      displayName: "Demo",
      duration: 10,
      fileName: "demo.mp3",
      fileSize: 5,
      mimeType: "audio/mpeg",
      objectUrl,
    });
    keepLocalFileUrl(objectUrl);
    insertNodeSession(patch([trackNode("file", picked, "file")]));
    let finishFade: () => void = () => undefined;
    const harness = createHarness({
      fadeOutSound: () =>
        new Promise<void>((resolve) => {
          finishFade = resolve;
        }),
    });
    instantStarts(harness.context);
    try {
      await harness.playback.activate();
      await harness.playback.setPlaying("file", true);
      loadNodeGraph(patch([]), harness.store);
      harness.playback.flush();
      await Promise.resolve();
      releaseUnusedLocalFileUrls();
      expect(harness.fadeOutSound).toHaveBeenCalled();
      expect(revokeUrl).not.toHaveBeenCalled();

      finishFade();
      await harness.playback.whenSettled();
      await Promise.resolve();
      expect(harness.context.channels.deactivate).toHaveBeenCalledWith(
        channelOf("file")
      );
      expect(revokeUrl).toHaveBeenCalledTimes(1);
      expect(revokeUrl).toHaveBeenCalledWith(objectUrl);
    } finally {
      revokeUrl.mockRestore();
      forgetLocalFileUrls();
    }
  });

  test("a static audio URL File survives a reload", async () => {
    const mp3: Radio = {
      id: "mp3",
      name: "track.mp3",
      platformMetadata: {
        displayName: "track",
        duration: 0,
        fileName: "track.mp3",
        fileSize: 0,
        isLocal: false,
        itemType: "track",
        mimeType: "audio/mpeg",
        platform: "static-audio",
        streamUrl: "https://files.example/track.mp3",
        url: "https://files.example/track.mp3",
      },
      streamUrl: "https://files.example/track.mp3",
    };
    insertNodeSession(patch([trackNode("file", mp3, "file")]));
    const harness = createHarness();
    instantStarts(harness.context);

    await harness.playback.activate();

    expect(getPlaybackChannelRuntime(channelOf("file")).soundId).toBe(
      soundOf("file")
    );
    await harness.playback.setPlaying("file", true);
    expect(getPlaybackChannelRuntime(channelOf("file")).isPlaying).toBe(true);
  });
});

describe("Node Playback: channel strips", () => {
  function withStrip(nodeId: string, strip: Record<string, unknown>) {
    return (graph: NodeGraph): NodeGraph =>
      setSourceStrip(graph, nodeId, strip);
  }

  /** Lane outputs whose levels the test can read, per lane and output. */
  function levelHarness() {
    let getLevels: ((laneId: string) => ReadonlyMap<string, number>) | null =
      null;
    const harness = createHarness({
      laneOutputs: (options) => {
        ({ getLevels } = options);
        return createNodeLaneOutputs(options);
      },
    });
    const levels = (laneId: string) =>
      Object.fromEntries(getLevels?.(laneId) ?? new Map());
    return { harness, levels };
  }

  test("a Station's +6 dB trim doubles its cable level and never writes its fader", async () => {
    insertNodeSession(patch([station("a", { volume: 0.7 })]));
    const { harness, levels } = levelHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);

    await commit(harness, withStrip("a", { trimDb: 6 }));

    expect(levels("a").speakers).toBeCloseTo(1.995, 2);
    expect(harness.context.channels.setVolume).not.toHaveBeenCalled();
    expect(
      harness.context.audioEngine.volume.setChannelVolume
    ).not.toHaveBeenCalled();
    expect(getPlaybackChannel("node", channelOf("a"))?.volume).toBe(0.7);
  });

  test("strip pan adds to a Pan node's pan, clamped, on the playing sound", async () => {
    insertNodeSession(
      nodeGraphSchema.parse({
        edges: [cable("a", "pan"), cable("pan", "speakers")],
        nodes: [
          station("a"),
          {
            data: { pan: 0.75 },
            id: "pan",
            position: { x: 0, y: 0 },
            type: "pan",
          },
          speakers,
        ],
        version: 2,
      })
    );
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);

    await commit(harness, withStrip("a", { pan: 0.5 }));

    expect(harness.context.audio.setPan).toHaveBeenLastCalledWith(
      soundOf("a"),
      1
    );
    expect(getPlaybackChannel("node", channelOf("a"))?.pan).toBe(1);
  });

  test("soloing one of three Stations silences the other two lanes, not their faders", async () => {
    insertNodeSession(patch([station("a"), station("b"), station("c")]));
    const { harness, levels } = levelHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.playAll();
    (harness.context.channels.setVolume as ReturnType<typeof mock>).mockClear();
    (harness.context.channels.setMuted as ReturnType<typeof mock>).mockClear();

    await commit(harness, withStrip("b", { solo: true }));

    expect([levels("a"), levels("b"), levels("c")]).toEqual([
      { speakers: 0 },
      { speakers: 1 },
      { speakers: 0 },
    ]);
    expect(harness.context.channels.setVolume).not.toHaveBeenCalled();
    expect(harness.context.channels.setMuted).not.toHaveBeenCalled();

    await commit(harness, withStrip("b", { solo: false }));

    expect([levels("a"), levels("b"), levels("c")]).toEqual([
      { speakers: 1 },
      { speakers: 1 },
      { speakers: 1 },
    ]);
  });

  test("a Track's speed and key lock reach its sound as it plays and on each change", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await commit(harness, withStrip("video", { keyLock: false, speed: 1.5 }));
    (
      harness.context.audio.setPlaybackRate as ReturnType<typeof mock>
    ).mockClear();

    // A load resets the element's rate, so playing writes it again.
    await harness.playback.setPlaying("video", true);

    expect(harness.context.audio.setPlaybackRate).toHaveBeenLastCalledWith(
      soundOf("video"),
      1.5
    );
    expect(harness.context.audio.setKeyLock).toHaveBeenLastCalledWith(
      soundOf("video"),
      false
    );
    expect(getPlaybackChannel("node", channelOf("video"))?.speed).toBe(1.5);

    await commit(harness, withStrip("video", { speed: 0.5 }));

    expect(harness.context.audio.setPlaybackRate).toHaveBeenLastCalledWith(
      soundOf("video"),
      0.5
    );
  });

  test("a Station has no transport: no speed reaches its sound", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);

    await commit(harness, withStrip("a", { speed: 1.5 }));

    expect(harness.context.audio.setPlaybackRate).not.toHaveBeenCalled();
    expect(
      harness.store.state.graph?.nodes.find((node) => node.id === "a")?.data
    ).not.toHaveProperty("strip.speed");
  });

  test("seek, Set cue and Cue go to the Track's sound", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const harness = createHarness();
    instantStarts(harness.context);
    harness.context.audio.getTrackProgress = mock(() => ({
      duration: 180,
      position: 42.5,
    }));
    await harness.playback.activate();
    await harness.playback.setPlaying("video", true);

    harness.playback.seek("video", 90);
    expect(harness.context.audioEngine.playback.seek).toHaveBeenLastCalledWith(
      soundOf("video"),
      90
    );

    harness.playback.setCue("video");
    await harness.playback.whenSettled();
    const node = harness.store.state.graph?.nodes.find(
      (entry) => entry.id === "video"
    );
    expect(node?.type === "platform" && node.data.strip.cue).toBe(42.5);

    harness.playback.jumpToCue("video");
    expect(harness.context.audioEngine.playback.seek).toHaveBeenLastCalledWith(
      soundOf("video"),
      42.5
    );
  });

  test("a looping Track repeats at its end instead of moving on", async () => {
    insertNodeSession(patch([trackNode("album", album)]));
    const resolveStream = mock(async () => null);
    const harness = createHarness({ resolveStream });
    instantStarts(harness.context);
    await harness.playback.activate();
    await commit(harness, withStrip("album", { loop: true }));
    await harness.playback.setPlaying("album", true);
    const plays = (harness.context.audio.playSound as ReturnType<typeof mock>)
      .mock.calls.length;

    laneWatcher(harness.context, "album")(audioState({ hasEnded: true }));
    await harness.playback.whenSettled();

    expect(harness.context.audioEngine.playback.seek).toHaveBeenCalledWith(
      soundOf("album"),
      0
    );
    expect(
      (harness.context.audio.playSound as ReturnType<typeof mock>).mock.calls
    ).toHaveLength(plays + 1);
    // Still on its first track: the loop kept it there.
    const node = harness.store.state.graph?.nodes.find(
      (entry) => entry.id === "album"
    );
    expect(node?.type === "platform" && node.data.radio?.streamUrl).toBe(
      album.streamUrl
    );
    expect(getPlaybackChannel("node", channelOf("album"))?.repeat).toBe(true);
  });

  test("cue listen taps the playing Track pre-fader onto the cue bus, and off again", async () => {
    insertNodeSession(patch([trackNode("video")]));
    const registration = {
      cleanup: mock(() => undefined),
      enabled: true,
      replaceTap: mock((_tap: AudioNode | null) => undefined),
      setEnabled: mock((_enabled: boolean) => undefined),
    };
    const registerCueDeck = mock(
      (_deckId: string, _tap: AudioNode | null, _enabled?: boolean) =>
        registration
    );
    // Node mode alone never builds the cue output: the tap applies it.
    const applySettings = mock(async () => ({}) as OutputRoutingSnapshot);
    const releaseCue = mock(() => undefined);
    const context = createTestContext();
    const store = createNodeStore();
    instantStarts(context);
    const playback = getNodePlayback({
      backendBadges: new Store<NodeBackendBadges>({}),
      ctx: context,
      cueOutput: () => ({ applySettings, registerCueDeck, releaseCue }),
      effects: { change: mock(async () => ({}) as ChannelEffectsResult) },
      fadeOutSound: mock(async () => undefined),
      getEnv: () => ({ crossOriginIsolated: false, profile: "desktop" }),
      sinkStatuses: new Store<NodeSinkStatuses>({}),
      store,
    });
    await playback.activate();
    await playback.setPlaying("video", true);
    expect(registerCueDeck).not.toHaveBeenCalled();
    expect(applySettings).not.toHaveBeenCalled();

    commitNodeGraph(withStrip("video", { cueListen: true }), store);
    await playback.whenSettled();

    expect(applySettings).toHaveBeenCalledTimes(1);

    expect(registerCueDeck).toHaveBeenCalledWith(
      "node:video",
      { soundId: soundOf("video") } as unknown as AudioNode,
      true
    );
    expect(getPlaybackChannel("node", channelOf("video"))?.cueEnabled).toBe(
      true
    );

    commitNodeGraph(withStrip("video", { cueListen: false }), store);
    await playback.whenSettled();

    expect(registration.cleanup).toHaveBeenCalledTimes(1);
    expect(releaseCue).not.toHaveBeenCalled();

    // The cue output it opened closes with the mode, as a DJ deck's does.
    await playback.deactivate();
    expect(releaseCue).toHaveBeenCalledTimes(1);
    await playback.activate();
    await playback.deactivate();
    expect(releaseCue).toHaveBeenCalledTimes(1);
  });

  test("a loaded patch has every Audio input's Monitor off", async () => {
    insertNodeSession(
      nodeGraphSchema.parse({
        edges: [cable("mic", "speakers")],
        nodes: [
          {
            data: { deviceId: "mic", strip: { monitor: true } },
            id: "mic",
            position: { x: 0, y: 0 },
            type: "deviceIn",
          },
          speakers,
        ],
        version: 2,
      })
    );
    const harness = createHarness();

    await harness.playback.activate();

    const node = harness.store.state.graph?.nodes.find(
      (entry) => entry.id === "mic"
    );
    expect(node?.type === "deviceIn" && node.data.strip.monitor).toBe(false);
    expect(harness.context.audio.playSound).not.toHaveBeenCalled();
  });
});
