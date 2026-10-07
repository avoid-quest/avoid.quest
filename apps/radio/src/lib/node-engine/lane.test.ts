/**
 * A lane's transitions, as a table: each row drives Node playback through
 * its public calls on a fake AudioManager whose plays, fades, ducks, effects
 * reconciles and track resolutions the row holds and releases, and checks
 * what a listener would hear. Sounds are named by their activation too
 * (`node:n:a#2` is lane a's second sound), so a row shows which sound a
 * start or an effects change reached. Every row also holds the lane owner's
 * invariants: a lane never has two sounds at once, nothing is left playing
 * or reported that the row didn't ask for, and every call settles.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Store } from "@tanstack/react-store";
import type {
  AudioEngineFacade,
  AudioManager,
  AudioState,
  Radio,
} from "@/lib/audio";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import type { NodeLaneOutputs } from "@/lib/audio/routing/node-lane-outputs";
import type { EffectsRuntimeOutcome } from "@/lib/channel-effects";
import {
  playbackSessionsCollection,
  stopLegacyMultipleListeners,
} from "@/lib/collections/playback-sessions";
import { settingsCollection } from "@/lib/collections/settings";
import type { PlatformStreamResolution } from "@/lib/dj-platform-stream-port";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import { setEffectParams, setSourceRadio } from "@/lib/node-graph/graph-edits";
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
import {
  getPlaybackChannelRuntime,
  resetAllPlaybackRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import {
  getNodePlayback,
  type NodeBackendBadges,
  type NodePlayback,
  type NodeSinkStatuses,
} from "../node-playback";
import type { PlaybackActionContext } from "../playback-action-context";

type NodeInput = NodeGraphInput["nodes"][number];

const speakers: NodeInput = {
  data: { muted: false },
  id: "speakers",
  position: { x: 480, y: 0 },
  type: "speakers",
};

function station(id: string, stream = id): NodeInput {
  return {
    data: {
      radio: {
        id: stream,
        name: `Station ${stream}`,
        streamUrl: `https://radio.example/${stream}.mp3`,
      },
    },
    id,
    position: { x: 0, y: 0 },
    type: "station",
  };
}

function video(id: string): Radio {
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

function track(id: string): NodeInput {
  return {
    data: { radio: video(id) },
    id,
    position: { x: 0, y: 0 },
    type: "platform",
  } as NodeInput;
}

function cable(source: string, target: string, targetHandle = "in:audio:main") {
  return {
    id: `${source}->${target}`,
    source,
    sourceHandle: "out:audio:main",
    target,
    targetHandle,
  };
}

function patch(sources: NodeInput[]): NodeGraph {
  return nodeGraphSchema.parse({
    edges: sources.map((node) => cable(node.id, "speakers")),
    nodes: [...sources, speakers],
    version: 2,
  });
}

/**
 * Station a through a Compressor to Speakers; with `key`, Station b plays
 * too and keys the Compressor.
 */
function compressed(key = false, others: NodeInput[] = []): NodeGraph {
  const sources = key ? [station("a"), station("b")] : [station("a")];
  return nodeGraphSchema.parse({
    edges: [
      cable("a", "comp"),
      cable("comp", "speakers"),
      ...(key
        ? [cable("b", "speakers"), cable("b", "comp", "in:sidechain:key")]
        : []),
      ...others.map((node) => cable(node.id, "speakers")),
    ],
    nodes: [
      ...sources,
      ...others,
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

const threshold = (value: number) => (graph: NodeGraph) =>
  setEffectParams(graph, "comp", { threshold: value } as Partial<EffectConfig>);
const DEFAULT_THRESHOLD = (
  createNodeEffectConfig("compressor", "comp") as { threshold: number }
).threshold;

const channelOf = (laneId: string) => `n:${laneId}`;
const soundOf = (laneId: string) => `node:n:${laneId}`;
/** Lane `laneId`'s `n`th sound. */
const sound = (laneId: string, n = 1) => `${soundOf(laneId)}#${n}`;

/** Something the row holds until it says so. */
type Held = { release: () => void; reject: (error: Error) => void };

/**
 * A fake AudioManager, channel facade and lane outputs. A sound is live
 * from its channel's activation to its release; plays, fades, ducks and
 * effects reconciles are held while `holdPlays`, `holdFades`, `holdDucks`
 * or `holdReconciles` is on, and track resolutions always are.
 */
function createWorld(directFields = false) {
  const live = new Set<string>();
  const activations = new Map<string, number>();
  const instanceOf = (soundId: string) =>
    `${soundId}#${activations.get(soundId) ?? 0}`;
  /** What reached the lanes' effects and outputs, in order. */
  const log: string[] = [];
  /** Sounds activated while their lane's previous sound was still live. */
  const overlaps: string[] = [];
  const plays: string[] = [];
  const heldPlays: Held[] = [];
  const heldFades: Held[] = [];
  const heldDucks: Held[] = [];
  const heldReconciles: Held[] = [];
  const heldResolutions: Array<{
    videoId: string;
    resolve: (value: PlatformStreamResolution | null) => void;
  }> = [];
  const refreshes: string[] = [];
  /** Lanes with an output to duck: their sound was attached to play. */
  const connected = new Set<string>();
  const options = {
    holdDucks: false as boolean,
    holdFades: false as boolean,
    holdPlays: false as boolean,
    holdReconciles: false as boolean,
    /** How each effects reconcile ends, as the controller reports it. */
    reconcileStatus: "inactive" as EffectsRuntimeOutcome["status"] | "rejected",
  };
  let stateListener: ((state: AudioState) => boolean | undefined) | null = null;

  const hold = (list: Held[], onRelease: () => void): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      list.push({
        reject,
        release: () => {
          onRelease();
          resolve();
        },
      });
    });

  const play = (soundId: string): Promise<void> => {
    plays.push(instanceOf(soundId));
    const channelId = soundId.slice("node:".length);
    const started = () => {
      // A sound released meanwhile reports nothing: it has no listener.
      if (live.has(soundId)) {
        setPlaybackChannelRuntime(channelId, () => ({
          isLoading: false,
          isPlaying: true,
        }));
      }
    };
    if (live.has(soundId)) {
      setPlaybackChannelRuntime(channelId, () => ({ isLoading: true }));
    }
    if (!options.holdPlays) {
      started();
      return Promise.resolve();
    }
    return hold(heldPlays, started);
  };

  const context: PlaybackActionContext = {
    audio: {
      cleanupSound: mock(() => undefined),
      getEffectsRuntimeOutcome: mock(
        (): EffectsRuntimeOutcome => ({
          backend: null,
          ready: false,
          status: "inactive",
        })
      ),
      getPreFaderNode: mock((soundId: string) => ({ soundId })),
      getTrackProgress: mock(() => null),
      hasSound: mock((soundId: string) => live.has(soundId)),
      pauseSound: mock((soundId: string) => {
        setPlaybackChannelRuntime(soundId.slice("node:".length), () => ({
          isLoading: false,
          isPlaying: false,
        }));
      }),
      playSound: mock(play),
      setGlobalVolume: mock(() => undefined),
      setKeyLock: mock(() => undefined),
      setPan: mock(() => undefined),
      setPlaybackRate: mock(() => undefined),
      setSoundOutputConnector: mock(() => undefined),
      updateFilter: mock(() => undefined),
    } as unknown as AudioManager,
    audioEngine: {
      playback: {
        pause: mock(() => undefined),
        play: mock(async () => undefined),
        refreshStreamUrl: mock((soundId: string, url: string) => {
          refreshes.push(`${soundId} ${url}`);
          return Promise.resolve();
        }),
        seek: mock(() => undefined),
      },
      volume: {
        setChannelVolume: mock(() => undefined),
        setMasterVolume: mock(() => undefined),
      },
    } satisfies AudioEngineFacade,
    channels: {
      activate: mock((_sessionId, channelId, _radio, activation) => {
        const soundId =
          typeof activation === "string"
            ? activation
            : (activation?.soundId ?? `node:${channelId}`);
        if (live.has(soundId)) {
          overlaps.push(soundId);
        }
        live.add(soundId);
        activations.set(soundId, (activations.get(soundId) ?? 0) + 1);
        setPlaybackChannelRuntime(channelId, () => ({ soundId }));
        return soundId;
      }),
      deactivate: mock((channelId: string) => {
        live.delete(`node:${channelId}`);
        resetPlaybackChannelRuntime(channelId);
      }),
      deactivateAll: mock(() => undefined),
      getOutputMode: mock(() => "audio-graph" as const),
      setMuted: mock(() => undefined),
      setPan: mock(() => undefined),
      setSpeed: mock(() => undefined),
      setVolume: mock(() => undefined),
      subscribeRuntime: mock((_sessionId, _channelId, _soundId, watch) => {
        stateListener = watch?.onAudioState ?? null;
      }),
    },
    getMainOutputRouter: () => null,
    lifecycle: { mainOutputSettingsApplied: true },
    reportError: mock(() => undefined),
    resetAudioManager: mock(() => undefined),
    resumeAudioContext: mock(async () => undefined),
  };

  const store = createNodeStore();
  const playback = getNodePlayback({
    backendBadges: new Store<NodeBackendBadges>({}),
    ctx: context,
    effects: {
      reconcileEffects: async (soundId, desired) => {
        const tree = desired.tree.map((effect) =>
          "threshold" in effect ? `${effect.id}@${effect.threshold}` : effect.id
        );
        const key = desired.sidechainSoundId
          ? ` key ${instanceOf(desired.sidechainSoundId)}`
          : "";
        log.push(`reconcile ${instanceOf(soundId)} [${tree.join(" ")}]${key}`);
        if (options.holdReconciles) {
          await hold(heldReconciles, () => undefined);
        }
        if (options.reconcileStatus === "rejected") {
          throw new Error("reconcile rejected");
        }
        return { backend: null, ready: false, status: options.reconcileStatus };
      },
      setEffectFields: (soundId, id, config) => {
        if (!directFields) {
          return "structural";
        }
        log.push(
          `field ${instanceOf(soundId)} ${id}@${"threshold" in config ? config.threshold : ""}`
        );
        return "applied";
      },
    },
    fadeOutSound: () =>
      options.holdFades ? hold(heldFades, () => undefined) : Promise.resolve(),
    getEnv: () => ({ crossOriginIsolated: false, profile: "desktop" }),
    laneOutputs: (): NodeLaneOutputs => ({
      attach: (laneId) => {
        connected.add(laneId);
      },
      dispose: () => undefined,
      dropSink: () => undefined,
      duck: (laneId) => {
        log.push(`duck ${laneId}`);
        if (!connected.has(laneId)) {
          return null;
        }
        return options.holdDucks
          ? hold(heldDucks, () => undefined)
          : Promise.resolve();
      },
      refresh: () => undefined,
      release: (laneId) => {
        connected.delete(laneId);
      },
      reroute: () => undefined,
      unduck: (laneId) => {
        log.push(`unduck ${laneId}`);
      },
    }),
    otherTabWrites: () => () => undefined,
    resolveStream: (input) =>
      new Promise((resolve) => {
        heldResolutions.push({
          resolve,
          videoId: "videoId" in input ? String(input.videoId) : "",
        });
      }),
    sinkStatuses: new Store<NodeSinkStatuses>({}),
    store,
  });

  return {
    context,
    heldDucks,
    heldFades,
    heldPlays,
    heldReconciles,
    heldResolutions,
    live,
    log,
    options,
    overlaps,
    playback,
    plays,
    refreshes,
    store,
    /** The state listener on the lane's latest watched sound. */
    watch: (state: Partial<AudioState>) =>
      stateListener?.({
        error: null,
        hasEnded: false,
        isBuffering: false,
        isLoading: false,
        isPlaying: false,
        volume: 1,
        ...state,
      }),
  };
}

type World = ReturnType<typeof createWorld> & {
  playback: NodePlayback;
  store: NodeStore;
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function releaseAll(list: Held[]): void {
  for (const held of list.splice(0)) {
    held.release();
  }
}

function replaceSource(world: World, laneId: string, stream: string) {
  commitNodeGraph(
    (graph) =>
      setSourceRadio(graph, laneId, {
        id: stream,
        name: `Station ${stream}`,
        streamUrl: `https://radio.example/${stream}.mp3`,
      }),
    world.store
  );
  world.playback.flush();
}

function commit(world: World, edit: (graph: NodeGraph) => NodeGraph) {
  commitNodeGraph(edit, world.store);
  world.playback.flush();
}

/** Clears what activation logged, once it settled. */
async function settled(world: World) {
  await world.playback.whenSettled();
  world.log.length = 0;
}

/** Plays the lane once, so it has an output a layout swap ducks. */
async function playedOnce(world: World, laneId: string, playing = true) {
  await world.playback.setPlaying(laneId, true);
  await world.playback.setPlaying(laneId, playing);
  await settled(world);
}

function interrupt(world: World) {
  world.watch({
    error: {
      code: "STREAM_INTERRUPTED",
      id: "e1",
      message: "expired",
      position: 42,
      timestamp: 1,
    },
  });
}

type Row = {
  directFields?: boolean;
  /** The lane's transition. */
  when: string;
  initial: NodeGraph;
  run: (world: World) => Promise<void>;
  /** What the listener hears once it settled. */
  expected: (world: World) => void;
};

const transitions: Row[] = [
  {
    expected(world) {
      expect(world.live.size).toBe(0);
      expect(getPlaybackChannelRuntime(channelOf("a"))).toMatchObject({
        isPlaying: false,
        soundId: null,
      });
    },
    initial: patch([station("a")]),
    async run(world) {
      world.options.holdPlays = true;
      const start = world.playback.setPlaying("a", true);
      commitNodeGraph(() => patch([]), world.store);
      world.playback.flush();
      await world.playback.whenSettled();
      releaseAll(world.heldPlays);
      await start;
    },
    when: "retire during start: the late play never lands",
  },
  {
    expected(world) {
      expect(world.context.channels.activate).toHaveBeenCalledTimes(2);
      expect(world.live).toEqual(new Set([soundOf("a")]));
      expect(world.plays).toEqual([]);
    },
    initial: patch([station("a")]),
    async run(world) {
      world.options.holdFades = true;
      commitNodeGraph(() => patch([]), world.store);
      world.playback.flush();
      await tick();
      commitNodeGraph(() => patch([station("a")]), world.store);
      world.playback.flush();
      await tick();
      expect(world.context.channels.activate).toHaveBeenCalledTimes(1);
      releaseAll(world.heldFades);
    },
    when: "re-add during fade: the new sound waits for the old one's release",
  },
  {
    expected(world) {
      expect(world.plays).toEqual([sound("a", 2)]);
      expect(getPlaybackChannelRuntime(channelOf("a")).isPlaying).toBe(true);
    },
    initial: patch([station("a")]),
    async run(world) {
      world.options.holdFades = true;
      commitNodeGraph(() => patch([]), world.store);
      world.playback.flush();
      commitNodeGraph(() => patch([station("a")]), world.store);
      world.playback.flush();
      const start = world.playback.setPlaying("a", true);
      await tick();
      expect(world.plays).toEqual([]);
      releaseAll(world.heldFades);
      await start;
    },
    when: "play during a re-add's fade: plays the new sound once it exists",
  },
  {
    expected(world) {
      expect(world.plays).toEqual([sound("a")]);
      expect(getPlaybackChannelRuntime(channelOf("a")).isPlaying).toBe(false);
    },
    initial: patch([station("a")]),
    async run(world) {
      await world.playback.setPlaying("a", true);
      world.options.holdFades = true;
      replaceSource(world, "a", "a2");
      await tick();
      await world.playback.setPlaying("a", false);
      releaseAll(world.heldFades);
    },
    when: "pause during the fade wait: the carried resume never runs",
  },
  {
    expected(world) {
      expect(world.plays).toEqual([sound("a", 2)]);
      expect(getPlaybackChannelRuntime(channelOf("a")).isPlaying).toBe(true);
      expect(world.context.channels.activate).toHaveBeenLastCalledWith(
        "node",
        channelOf("a"),
        expect.objectContaining({ id: "a3" }),
        expect.anything()
      );
    },
    initial: patch([station("a")]),
    async run(world) {
      world.options.holdFades = true;
      replaceSource(world, "a", "a2");
      const start = world.playback.setPlaying("a", true);
      await tick();
      replaceSource(world, "a", "a3");
      await tick();
      releaseAll(world.heldFades);
      await tick();
      releaseAll(world.heldFades);
      await start;
    },
    when: "a play waiting on a fade survives a second replacement",
  },
  {
    expected(world) {
      expect(world.plays).toEqual([sound("a"), sound("a", 2)]);
      expect(getPlaybackChannelRuntime(channelOf("a")).isPlaying).toBe(true);
      expect(world.context.channels.activate).toHaveBeenLastCalledWith(
        "node",
        channelOf("a"),
        expect.objectContaining({ id: "a2" }),
        expect.anything()
      );
    },
    initial: patch([station("a")]),
    async run(world) {
      world.options.holdPlays = true;
      const start = world.playback.setPlaying("a", true);
      replaceSource(world, "a", "a2");
      await tick();
      releaseAll(world.heldPlays);
      await tick();
      releaseAll(world.heldPlays);
      await start;
    },
    when: "a start in progress carries to its lane's replacement",
  },
  {
    expected(world) {
      expect(world.refreshes).toEqual([]);
      expect(getPlaybackChannelRuntime(channelOf("v")).isPlaying).toBe(false);
    },
    initial: patch([track("v")]),
    async run(world) {
      await world.playback.setPlaying("v", true);
      interrupt(world);
      await world.playback.setPlaying("v", false);
      for (const resolution of world.heldResolutions.splice(0)) {
        resolution.resolve({
          streamFormat: "progressive",
          streamUrl: "https://media.example/renewed.m4a",
        });
      }
    },
    when: "renewal after pause: the renewed stream never resumes",
  },
  {
    expected(world) {
      const node = world.store.state.graph?.nodes.find(({ id }) => id === "v");
      expect(node?.data).toMatchObject({
        radio: { streamUrl: "https://media.example/new.m4a" },
      });
      expect(world.plays).toEqual([sound("v", 2)]);
    },
    initial: patch([track("v")]),
    async run(world) {
      const older = world.playback.playTrack("v", "yt:old");
      const newer = world.playback.playTrack("v", "yt:new");
      const [first, second] = world.heldResolutions.splice(0);
      first?.resolve({
        streamFormat: "progressive",
        streamUrl: "https://media.example/old.m4a",
      });
      await older;
      second?.resolve({
        streamFormat: "progressive",
        streamUrl: "https://media.example/new.m4a",
      });
      await newer;
    },
    when: "a pick superseded by a newer pick never commits",
  },
  {
    expected(world) {
      const node = world.store.state.graph?.nodes.find(({ id }) => id === "v");
      expect(node?.data).toMatchObject({
        radio: { streamUrl: "https://media.example/v.m4a" },
      });
      expect(world.plays).toEqual([]);
      expect(getPlaybackChannelRuntime(channelOf("v")).isPlaying).toBe(false);
    },
    initial: patch([track("v")]),
    async run(world) {
      await settled(world);
      const picked = world.playback.playTrack(
        "v",
        "https://media.example/picked.m4a"
      );
      // The pause lands after the pick resolved, before the lane hears it.
      queueMicrotask(() => world.playback.setPlaying("v", false));
      await picked;
    },
    when: "pause as a pick resolves: the pick never commits or plays",
  },
  {
    expected(world) {
      expect(world.live.size).toBe(0);
      for (const laneId of ["a", "b", "v"]) {
        expect(getPlaybackChannelRuntime(channelOf(laneId))).toMatchObject({
          isPlaying: false,
          soundId: null,
        });
      }
      expect(world.plays).toEqual([sound("a")]);
    },
    initial: patch([station("a"), station("b"), track("v")]),
    async run(world) {
      world.options.holdPlays = true;
      world.options.holdFades = true;
      const startA = world.playback.setPlaying("a", true);
      replaceSource(world, "b", "b2");
      const pick = world.playback.playTrack("v", "yt:next");
      const deactivation = world.playback.deactivate();
      const startB = world.playback.setPlaying("b", true);
      for (const resolution of world.heldResolutions.splice(0)) {
        resolution.resolve({
          streamFormat: "progressive",
          streamUrl: "https://media.example/next.m4a",
        });
      }
      releaseAll(world.heldFades);
      await tick();
      releaseAll(world.heldFades);
      releaseAll(world.heldPlays);
      await Promise.all([startA, startB, pick, deactivation]);
    },
    when: "dispose during everything: nothing plays or lives on",
  },
  {
    expected() {
      expect(getPlaybackChannelRuntime(channelOf("a")).isPlaying).toBe(true);
    },
    initial: patch([station("a")]),
    async run(world) {
      world.options.holdPlays = true;
      const start = world.playback.setPlaying("a", true);
      // Still inside the gesture's task: no await ran before the play.
      expect(world.plays).toEqual([sound("a")]);
      releaseAll(world.heldPlays);
      await start;
    },
    when: "an idle lane's start is synchronous up to the play call",
  },
  {
    expected(world) {
      expect(world.context.channels.activate).toHaveBeenCalledTimes(1);
      expect(world.live.size).toBe(0);
    },
    initial: patch([station("a")]),
    async run(world) {
      world.options.holdFades = true;
      commitNodeGraph(() => patch([]), world.store);
      world.playback.flush();
      commitNodeGraph(() => patch([station("a")]), world.store);
      world.playback.flush();
      commitNodeGraph(() => patch([]), world.store);
      world.playback.flush();
      await tick();
      releaseAll(world.heldFades);
    },
    when: "removed, re-added and removed in one fade: no sound is made",
  },
  {
    expected(world) {
      expect(world.log).toEqual([
        "duck a",
        `reconcile ${sound("b")} []`,
        `reconcile ${sound("a")} [comp@${DEFAULT_THRESHOLD}] key ${sound("b")}`,
        "unduck a",
      ]);
    },
    initial: patch([station("a")]),
    async run(world) {
      await playedOnce(world, "a");
      commit(world, () => compressed(true));
    },
    when: "a new FX layout keyed from a new lane: its keyed tree is in before the duck lifts",
  },
  {
    expected(world) {
      expect(world.log).toEqual([
        "duck a",
        `reconcile ${sound("a")} [comp@${DEFAULT_THRESHOLD}]`,
        `reconcile ${sound("a")} [comp@-12]`,
        "unduck a",
      ]);
    },
    initial: patch([station("a")]),
    async run(world) {
      await playedOnce(world, "a");
      world.options.holdReconciles = true;
      commit(world, () => compressed());
      await tick();
      commit(world, threshold(-12));
      releaseAll(world.heldReconciles);
      await tick();
      expect(world.log).not.toContain("unduck a");
      releaseAll(world.heldReconciles);
    },
    when: "a knob turned while a new FX layout reconciles is in before the duck lifts",
  },
  {
    expected(world) {
      expect(world.log).toEqual([
        "duck a",
        `reconcile ${sound("a")} [comp@-12]`,
        "unduck a",
      ]);
    },
    initial: patch([station("a")]),
    async run(world) {
      await playedOnce(world, "a");
      commit(world, () => compressed());
      commit(world, threshold(-12));
    },
    when: "a knob turned in the same turn as a new FX layout swaps in with it",
  },
  {
    expected(world) {
      expect(world.plays).toEqual([sound("a"), sound("a")]);
      expect(world.log).toEqual([
        "duck a",
        `reconcile ${sound("a")} [comp@${DEFAULT_THRESHOLD}]`,
        "unduck a",
      ]);
      expect(getPlaybackChannelRuntime(channelOf("a")).isPlaying).toBe(true);
    },
    initial: patch([station("a")]),
    async run(world) {
      await playedOnce(world, "a", false);
      world.options.holdDucks = true;
      commit(world, () => compressed());
      const start = world.playback.setPlaying("a", true);
      // Still inside the gesture's task, and the lane still ducked.
      expect(world.plays).toEqual([sound("a"), sound("a")]);
      expect(world.log).toEqual(["duck a"]);
      releaseAll(world.heldDucks);
      await start;
    },
    when: "a start during a layout swap is synchronous up to the play call, ducked",
  },
  {
    expected(world) {
      expect(world.plays).toEqual([sound("a")]);
      expect(world.log).toEqual([
        "duck a",
        `reconcile ${sound("a")} [comp@${DEFAULT_THRESHOLD}]`,
        "duck a",
        `reconcile ${sound("a")} []`,
        "unduck a",
      ]);
      expect(getPlaybackChannelRuntime(channelOf("a")).isPlaying).toBe(true);
    },
    initial: patch([station("a")]),
    async run(world) {
      await settled(world);
      world.options.holdReconciles = true;
      commit(world, () => compressed());
      const start = world.playback.setPlaying("a", true);
      // Nothing played yet to duck: the sound connects with its new layout
      // already reconciling, so its effects come up silent, never dry.
      expect(world.log).toEqual([
        "duck a",
        `reconcile ${sound("a")} [comp@${DEFAULT_THRESHOLD}]`,
      ]);
      expect(world.plays).toEqual([sound("a")]);
      // It plays now, so the next layout swaps under a duck.
      commit(world, () => patch([station("a")]));
      world.options.holdReconciles = false;
      releaseAll(world.heldReconciles);
      await start;
    },
    when: "the first play after a new FX layout connects with that layout in",
  },
  {
    expected(world) {
      expect(world.log).toEqual([
        "duck a",
        `reconcile ${sound("a")} [comp@${DEFAULT_THRESHOLD}]`,
        "unduck a",
        "duck a",
        `reconcile ${sound("a")} [comp@-12]`,
        "unduck a",
      ]);
    },
    initial: patch([station("a")]),
    async run(world) {
      await playedOnce(world, "a");
      world.options.holdReconciles = true;
      commit(world, () => compressed());
      await tick();
      for (const held of world.heldReconciles.splice(0)) {
        held.reject(new Error("The effects runtime failed"));
      }
      world.options.holdReconciles = false;
      // It waits for the next change rather than retrying at once.
      await world.playback.whenSettled();
      expect(world.log).toHaveLength(3);
      commit(world, threshold(-12));
    },
    when: "a new FX layout that failed to go in swaps again, ducked, on the next change",
  },
  ...(
    [
      ["failed", "is undone", () => patch([station("a")]), "[]"],
      ["superseded", "has a knob turned", threshold(-12), "[comp@-12]"],
      ["rejected", "is undone", () => patch([station("a")]), "[]"],
    ] as const
  ).map(
    ([status, edit, next, tree]): Row => ({
      directFields: true,
      expected(world) {
        // The graph may hold neither layout, so the next change swaps too.
        expect(world.log).toEqual([
          "duck a",
          `reconcile ${sound("a")} [comp@${DEFAULT_THRESHOLD}]`,
          "unduck a",
          "duck a",
          `reconcile ${sound("a")} ${tree}`,
          "unduck a",
        ]);
      },
      initial: patch([station("a")]),
      async run(world) {
        await playedOnce(world, "a");
        world.options.reconcileStatus = status;
        commit(world, () => compressed());
        await world.playback.whenSettled();
        world.options.reconcileStatus = "inactive";
        commit(world, next);
      },
      when: `a new FX layout whose reconcile ${status} swaps again, ducked, when it ${edit}`,
    })
  ),
  {
    expected(world) {
      expect(world.live).toEqual(new Set([soundOf("a")]));
      // The abandoned swap never lifts a duck or reaches the new sound.
      expect(world.log).toEqual([
        "duck a",
        `reconcile ${sound("a")} [comp@${DEFAULT_THRESHOLD}]`,
        `reconcile ${sound("a", 2)} []`,
      ]);
    },
    initial: patch([station("a")]),
    async run(world) {
      await settled(world);
      world.options.holdReconciles = true;
      commit(world, () => compressed());
      await tick();
      commit(world, () => patch([]));
      // The removal doesn't wait for the swap's reconcile.
      await world.playback.whenSettled();
      expect(world.live.size).toBe(0);
      world.options.holdReconciles = false;
      commit(world, () => patch([station("a")]));
      releaseAll(world.heldReconciles);
    },
    when: "retire during a layout swap: the lane releases at once",
  },
  {
    expected(world) {
      expect(world.live.size).toBe(0);
      expect(world.refreshes).toEqual([]);
      expect(world.log).not.toContain("unduck a");
    },
    initial: compressed(false, [track("v")]),
    async run(world) {
      await world.playback.setPlaying("v", true);
      await settled(world);
      interrupt(world);
      world.options.holdDucks = true;
      commit(world, () => patch([station("a"), track("v")]));
      // Deactivation ends while the swap and the stream refresh are pending.
      await world.playback.deactivate();
      expect(world.live.size).toBe(0);
      releaseAll(world.heldDucks);
      for (const resolution of world.heldResolutions.splice(0)) {
        resolution.resolve({
          streamFormat: "progressive",
          streamUrl: "https://media.example/renewed.m4a",
        });
      }
    },
    when: "dispose during a layout swap and a stream refresh: nothing waits on them",
  },
  {
    expected(world) {
      const { channels, audio } = world.context;
      // Nothing reached the fading sound; its successor was made muted.
      expect(channels.setVolume).not.toHaveBeenCalled();
      expect(channels.setMuted).toHaveBeenCalledTimes(1);
      expect(channels.setMuted).toHaveBeenCalledWith(
        "node",
        channelOf("a"),
        true
      );
      expect(world.plays).toEqual([sound("a"), sound("a", 2)]);
      expect(audio.playSound).toHaveBeenLastCalledWith(soundOf("a"), 0);
    },
    initial: patch([station("a")]),
    async run(world) {
      await world.playback.setPlaying("a", true);
      world.options.holdFades = true;
      replaceSource(world, "a", "a2");
      (world.context.channels.setMuted as ReturnType<typeof mock>).mockClear();
      world.playback.setVolume("a", 0.5);
      world.playback.toggleMute("a");
      world.playback.flush();
      await tick();
      expect(world.context.channels.setMuted).not.toHaveBeenCalled();
      releaseAll(world.heldFades);
    },
    when: "volume and mute during a predecessor's fade reach only its successor",
  },
  {
    expected(world) {
      expect(world.live).toEqual(new Set([soundOf("a")]));
      expect(world.log).toEqual([
        `reconcile ${sound("a")} [comp@-12]`,
        `reconcile ${sound("a", 2)} [comp@${DEFAULT_THRESHOLD}]`,
      ]);
    },
    initial: compressed(),
    async run(world) {
      await settled(world);
      world.options.holdReconciles = true;
      commit(world, threshold(-12));
      commit(world, () => patch([]));
      // The removal doesn't wait for the reconcile.
      await world.playback.whenSettled();
      expect(world.live.size).toBe(0);
      world.options.holdReconciles = false;
      commit(world, () => compressed());
      releaseAll(world.heldReconciles);
    },
    when: "retire during an effects reconcile: the lane releases at once",
  },
  {
    expected(world) {
      expect(world.live.size).toBe(0);
      expect(world.refreshes).toEqual([]);
    },
    initial: compressed(false, [track("v")]),
    async run(world) {
      await world.playback.setPlaying("v", true);
      await settled(world);
      interrupt(world);
      world.options.holdReconciles = true;
      commit(world, threshold(-12));
      // Deactivation ends while the reconcile and the stream refresh pend.
      await world.playback.deactivate();
      expect(world.live.size).toBe(0);
      releaseAll(world.heldReconciles);
      for (const resolution of world.heldResolutions.splice(0)) {
        resolution.resolve({
          streamFormat: "progressive",
          streamUrl: "https://media.example/renewed.m4a",
        });
      }
    },
    when: "dispose during an effects reconcile and a stream refresh: nothing waits on them",
  },
  {
    expected(world) {
      expect(world.log).toEqual([`reconcile ${sound("a")} [comp@-12]`]);
      expect(getPlaybackChannelRuntime(channelOf("a")).isPlaying).toBe(true);
    },
    initial: compressed(),
    async run(world) {
      await settled(world);
      world.options.holdReconciles = true;
      commit(world, threshold(-12));
      const start = world.playback.setPlaying("a", true);
      // Still inside the gesture's task, beside the reconcile.
      expect(world.plays).toEqual([sound("a")]);
      releaseAll(world.heldReconciles);
      await start;
    },
    when: "a start while effects reconcile is synchronous up to the play call",
  },
];

let activeWorld: World | null = null;

beforeEach(async () => {
  await Promise.all([
    playbackSessionsCollection.stateWhenReady(),
    settingsCollection.stateWhenReady(),
  ]);
  resetAllPlaybackRuntime();
  settingsCollection.insert({
    audio: {
      cueOutputId: null,
      delay: { cueDelayMs: 0, mainDelayMs: 0 },
      mainOutputId: "default",
    },
    id: "app-settings",
    player: { mode: "node", restoreStateOnLoad: true },
  });
});

afterEach(async () => {
  activeWorld?.playback.flush();
  activeWorld = null;
  await Promise.resolve();
  stopLegacyMultipleListeners();
  for (const id of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(id);
  }
  for (const id of Array.from(settingsCollection.state.keys())) {
    settingsCollection.delete(id);
  }
  resetAllPlaybackRuntime();
});

describe("Node lane transitions", () => {
  test("knobs reach the live sound in place and never the retiring sound", async () => {
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [],
      crossfadePosition: 0.5,
      graph: compressed(),
      headphoneVolume: 1,
      id: "node",
      masterVolume: 1,
    });
    const world = createWorld(true);
    activeWorld = world;
    await world.playback.activate();
    await settled(world);
    commit(world, threshold(-24));
    await world.playback.whenSettled();
    expect(world.log).toEqual([`field ${sound("a")} comp@-24`]);
    world.options.holdFades = true;
    replaceSource(world, "a", "next");
    world.log.length = 0;
    commit(world, threshold(-30));
    expect(world.log).toEqual([]);
    releaseAll(world.heldFades);
    await world.playback.whenSettled();
    expect(world.log).toEqual([`reconcile ${sound("a", 2)} [comp@-30]`]);
    world.options.holdFades = false;
    await world.playback.deactivate();
  });

  test.each(transitions.map((row) => [row.when, row] as const))(
    "%s",
    async (_when, row) => {
      playbackSessionsCollection.insert({
        activeChannelId: null,
        channels: [],
        crossfadePosition: 0.5,
        graph: row.initial,
        headphoneVolume: 1,
        id: "node",
        masterVolume: 1,
      });
      const world = createWorld(row.directFields);
      activeWorld = world;
      await world.playback.activate();

      await row.run(world);
      await world.playback.whenSettled();

      row.expected(world);
      expect(world.overlaps).toEqual([]);
      expect(world.context.reportError).not.toHaveBeenCalled();
    }
  );
});
