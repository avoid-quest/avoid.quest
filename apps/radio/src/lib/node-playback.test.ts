import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioEngineFacade, AudioManager, Radio } from "@/lib/audio";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import {
  getPlaybackChannel,
  getPlaybackSession,
  playbackSessionsCollection,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { settingsCollection } from "@/lib/collections/settings";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import {
  commitNodeGraph,
  createNodeStore,
  type NodeStore,
} from "@/lib/node-graph/node-store";
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
import type { ChannelEffectsResult } from "./channel-effects";
import { getNodePlayback, type NodePlayback } from "./node-playback";
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
      hasSound: mock((_soundId: string) => false),
      pauseSound: mock((_soundId: string) => undefined),
      playSound: mock(async (_soundId: string, _volume: number) => undefined),
      setGlobalVolume: mock((_volume: number) => undefined),
      setMainDelay: mock((_delayMs: number) => undefined),
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
    context?: PlaybackActionContext;
    fadeOutSound?: (soundId: string, durationMs: number) => Promise<void>;
    profile?: Profile;
  } = {}
): Harness {
  const context = options.context ?? createTestContext();
  const store = createNodeStore();
  const effectsChange = mock(async () => ({}) as ChannelEffectsResult);
  const fadeOutSound = mock(
    options.fadeOutSound ?? (async (_soundId: string) => undefined)
  );
  const playback = getNodePlayback({
    ctx: context,
    effects: { change: effectsChange },
    fadeOutSound,
    getEnv: () => ({
      crossOriginIsolated: false,
      profile: options.profile ?? "desktop",
    }),
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
