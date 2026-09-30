import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Store } from "@tanstack/react-store";
import type { AudioEngineFacade, AudioManager, Radio } from "@/lib/audio";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import type {
  MainOutputConnect,
  SoundOutputConnector,
} from "@/lib/audio/manager/audio-manager-types";
import {
  createFakeFader,
  FakeAudioContext,
  type FakeGainNode,
} from "@/lib/audio/routing/fake-audio-nodes";
import {
  createNodeLaneOutputs,
  LANE_DUCK_MS,
  LANE_LEVEL_TIME_CONSTANT_S,
} from "@/lib/audio/routing/node-lane-outputs";
import {
  getPlaybackChannel,
  getPlaybackSession,
  initializePlaybackSessions,
  playbackSessionsCollection,
  stopLegacyMultipleListeners,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { settingsCollection } from "@/lib/collections/settings";
import { setBandCount } from "@/lib/node-graph/branches";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import { compile } from "@/lib/node-graph/compile";
import { setEffectParams } from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  createNodeStore,
  type NodeStore,
} from "@/lib/node-graph/node-store";
import { diff } from "@/lib/node-graph/reconcile";
import {
  type NodeGraph,
  type NodeGraphInput,
  nodeGraphSchema,
} from "@/lib/node-graph/schema";
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
} from "./node-playback";
import type { OutputRouting } from "./output-routing";
import type { PlaybackActionContext } from "./playback-action-context";

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
    version: 1,
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
      hasSound: mock((_soundId: string) => false),
      pauseSound: mock((_soundId: string) => undefined),
      playSound: mock(async (_soundId: string, _volume: number) => undefined),
      setGlobalVolume: mock((_volume: number) => undefined),
      setMainDelay: mock((_delayMs: number) => undefined),
      setPan: mock((_soundId: string, _pan: number) => undefined),
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
  playback: NodePlayback;
  store: NodeStore;
};

function createHarness(
  options: {
    backendBadges?: NodeBackendBadgeStore;
    context?: PlaybackActionContext;
    crossOriginIsolated?: boolean;
    effects?: GetNodePlaybackOptions["effects"];
    effectsOutcome?: () => EffectsRuntimeOutcome;
    fadeOutSound?: (soundId: string, durationMs: number) => Promise<void>;
    laneOutputs?: GetNodePlaybackOptions["laneOutputs"];
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
    store,
  });
  return { context, effectsChange, fadeOutSound, playback, store };
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
        version: 1,
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

  test("activation restores valid Stations and resets local files", async () => {
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
    setPlaybackChannelRuntime(channelOf("local"), () => ({
      isPlaying: true,
      soundId: soundOf("local"),
    }));
    const harness = createHarness();

    await harness.playback.activate();

    expect(getPlaybackChannelRuntime(channelOf("valid")).soundId).toBe(
      soundOf("valid")
    );
    expect(getPlaybackChannelRuntime(channelOf("local"))).toMatchObject({
      error: null,
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
    return nodeGraphSchema.parse({ edges, nodes, version: 1 });
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
    const laneOut = audio.gains.at(-1) as FakeGainNode;
    return { audio, connectMain, fader, laneOut, releaseMain };
  }

  function levelOf(laneOut: FakeGainNode) {
    const last = laneOut.gain.events.at(-1);
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

  test("cable gain, mute and removal ramp laneOut with τ 5 ms and leave the fader alone", async () => {
    insertNodeSession(patch([station("a")]));
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);
    const { connectMain, fader, laneOut } = connectLane(harness.context, "a");

    expect(connectMain).toHaveBeenCalledWith(laneOut, false);
    expect(fader.connections.has(laneOut)).toBe(true);
    expect(laneOut.gain.value).toBe(0);
    expect(levelOf(laneOut)).toBe(1);

    await commit(harness, withCable("a->speakers", { muted: true }));
    expect(laneOut.gain.events.at(-1)).toEqual({
      time: 0,
      timeConstant: LANE_LEVEL_TIME_CONSTANT_S,
      type: "target",
      value: 0,
    });

    await commit(
      harness,
      withCable("a->speakers", { gain: 0.5, muted: false })
    );
    expect(levelOf(laneOut)).toBe(0.5);

    await commit(harness, (graph) => ({ ...graph, edges: [] }));
    expect(levelOf(laneOut)).toBe(0);

    await commit(harness, () => patch([station("a")]));
    expect(levelOf(laneOut)).toBe(1);

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
    const eventsBefore = old.laneOut.gain.events.length;
    const saved = { ...radio("a"), id: "saved-a" };

    await commit(harness, (graph) =>
      withCable("a->speakers", { muted: true })(
        withStation("a", { radio: saved })(graph)
      )
    );

    expect(harness.fadeOutSound).toHaveBeenCalledWith(soundOf("a"), 150, true);
    expect(old.laneOut.gain.events).toHaveLength(eventsBefore);
    expect(levelOf(old.laneOut)).toBe(1);
    // The new stream's laneOut starts at the new level.
    const next = connectLane(harness.context, "a");
    expect(next.laneOut).not.toBe(old.laneOut);
    expect(levelOf(next.laneOut)).toBe(0);
  });

  test("a Station with no cable to Speakers plays silent", async () => {
    insertNodeSession(
      nodeGraphSchema.parse({
        edges: [],
        nodes: [station("a"), speakers],
        version: 1,
      })
    );
    const harness = createHarness();
    instantStarts(harness.context);
    await harness.playback.activate();
    await harness.playback.setPlaying("a", true);

    const { laneOut } = connectLane(harness.context, "a");

    expect(levelOf(laneOut)).toBe(0);
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
          version: 1,
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
        version: 1,
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
          version: 1,
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
      version: 1,
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
});
