import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDefaultEffectConfig } from "@/lib/audio";
import {
  createLocalNamModelId,
  getCachedNamModel,
  saveNamModel,
} from "@/lib/audio/dsp/effects/nam-model-store";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import { laneChannelId, laneSoundId } from "@/lib/node-graph/compile";
import type { NodeGraphInput } from "@/lib/node-graph/schema";
import {
  buildDjSessionFromLegacyState,
  buildMultipleSessionFromRadios,
  buildSingleSessionFromLegacyState,
  createDefaultChannel,
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  deletePlaybackSession,
  getNodeChannelId,
  getPlaybackSession,
  initializePlaybackSessions,
  parsePlaybackSessionRecord,
  playbackSessionsCollection,
  removePlaybackChannel,
  SINGLE_ACTIVE_CHANNEL_ID,
  updatePlaybackChannel,
  updatePlaybackSession,
} from "./playback-sessions";
import { radiosCollection } from "./radios";
import { addSessionRadio, sessionRadiosCollection } from "./session-radios";
import { settingsCollection } from "./settings";

const PLAYBACK_SESSIONS_STORAGE_KEY = "radio-app-playback-sessions";
const RADIOS_STORAGE_KEY = "radio-app-radios";
const SETTINGS_STORAGE_KEY = "radio-app-settings";
const LEGACY_SINGLE_STATE_KEY = "radio-app-single-state";
const LEGACY_DJ_DECKS_KEY = "radio-app-dj-decks";
const LEGACY_DJ_MIXER_KEY = "radio-app-dj-mixer";
const SETTINGS_ID = "app-settings";

function createMemoryStorage(): Storage {
  const state = new Map<string, string>();

  return {
    clear() {
      state.clear();
    },
    getItem(key) {
      return state.get(key) ?? null;
    },
    key(index) {
      return Array.from(state.keys())[index] ?? null;
    },
    get length() {
      return state.size;
    },
    removeItem(key) {
      state.delete(key);
    },
    setItem(key, value) {
      state.set(key, value);
    },
  };
}

if (typeof sessionStorage === "undefined") {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: createMemoryStorage(),
  });
}

async function resetPlaybackState() {
  await Promise.all([
    playbackSessionsCollection.stateWhenReady(),
    radiosCollection.stateWhenReady(),
    settingsCollection.stateWhenReady(),
    sessionRadiosCollection.stateWhenReady(),
  ]);

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }

  for (const radioId of Array.from(radiosCollection.state.keys())) {
    radiosCollection.delete(radioId);
  }

  for (const settingsId of Array.from(settingsCollection.state.keys())) {
    settingsCollection.delete(settingsId);
  }

  for (const radioId of Array.from(sessionRadiosCollection.state.keys())) {
    sessionRadiosCollection.delete(radioId);
  }

  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(PLAYBACK_SESSIONS_STORAGE_KEY);
    localStorage.removeItem(RADIOS_STORAGE_KEY);
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    localStorage.removeItem(LEGACY_SINGLE_STATE_KEY);
    localStorage.removeItem(LEGACY_DJ_DECKS_KEY);
    localStorage.removeItem(LEGACY_DJ_MIXER_KEY);
  }

  if (typeof sessionStorage !== "undefined") {
    sessionStorage.clear();
  }
}

beforeEach(async () => {
  await resetPlaybackState();
});

afterEach(async () => {
  await resetPlaybackState();
});

describe("buildSingleSessionFromLegacyState", () => {
  test("maps legacy single radio and volume onto the active hidden channel", () => {
    const radio = {
      id: "radio-1",
      name: "Legacy FM",
      streamUrl: "https://radio.example/live.mp3",
    };

    const session = buildSingleSessionFromLegacyState({
      radio,
      volume: 0.42,
    });

    expect(session.id).toBe("single");
    expect(session.activeChannelId).toBe(SINGLE_ACTIVE_CHANNEL_ID);
    expect(session.channels).toHaveLength(2);
    expect(session.channels[0]?.radio).toEqual(radio);
    expect(session.channels[0]?.volume).toBe(0.42);
    expect(session.channels[1]?.radio).toBeNull();
  });

  test("falls back to an empty session when legacy data is missing", () => {
    const session = buildSingleSessionFromLegacyState();

    expect(session.activeChannelId).toBeNull();
    expect(session.channels[0]?.radio).toBeNull();
    expect(session.channels[0]?.volume).toBe(1);
  });
});

describe("local NAM model garbage collection", () => {
  test("collects nested removals, replacements, channels, and sessions while preserving shared references", async () => {
    const sharedId = createLocalNamModelId();
    const nestedOnlyId = createLocalNamModelId();
    const replacementId = createLocalNamModelId();
    await Promise.all([
      saveNamModel(sharedId, '{"shared":true}'),
      saveNamModel(nestedOnlyId, '{"nested":true}'),
      saveNamModel(replacementId, '{"replacement":true}'),
    ]);

    const shared = createDefaultEffectConfig("neuralAmp", "shared", 0);
    shared.modelId = sharedId;
    const nestedShared = {
      ...shared,
      id: "nested-shared",
    };
    const nestedOnly = createDefaultEffectConfig("neuralAmp", "nested-only", 1);
    nestedOnly.modelId = nestedOnlyId;
    const container = createDefaultEffectConfig("fxComposite", "container", 0);
    const [firstChain] = container.chains;
    if (!firstChain) {
      throw new Error("Default composite requires a chain");
    }
    firstChain.effects = [nestedShared, nestedOnly];

    playbackSessionsCollection.insert({
      activeChannelId: "single-a",
      channels: [
        {
          ...createDefaultChannel("single-a", "single-primary", 0),
          effects: [shared],
        },
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "single",
      masterVolume: 1,
      tempo: 120,
    });
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [
        {
          ...createDefaultChannel("deck-a", "deck-a", 0),
          effects: [container],
        },
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "dj",
      masterVolume: 1,
      tempo: 120,
    });

    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.effects = [];
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(getCachedNamModel(nestedOnlyId)).toBeNull();
    expect(getCachedNamModel(sharedId)).toBe('{"shared":true}');

    updatePlaybackChannel("single", "single-a", (draft) => {
      const replacement = createDefaultEffectConfig("neuralAmp", "shared", 0);
      replacement.modelId = replacementId;
      draft.effects = [replacement];
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(getCachedNamModel(sharedId)).toBeNull();
    expect(getCachedNamModel(replacementId)).toBe('{"replacement":true}');

    removePlaybackChannel("single", "single-a");
    await Promise.resolve();
    await Promise.resolve();
    expect(getCachedNamModel(replacementId)).toBeNull();

    deletePlaybackSession("dj");
    deletePlaybackSession("single");
  });
});

describe("buildDjSessionFromLegacyState", () => {
  test("preserves deck assignment and mixer values from legacy dj state", () => {
    const deckARadio = {
      id: "deck-a-radio",
      name: "Deck A",
      streamFormat: "hls" as const,
      streamUrl: "https://radio.example/deck-a.mp3",
    };
    const deckBRadio = {
      id: "deck-b-radio",
      name: "Deck B",
      streamUrl: "https://radio.example/deck-b.mp3",
    };

    const session = buildDjSessionFromLegacyState({
      legacyDecks: [
        {
          id: DECK_A_CHANNEL_ID,
          pan: -0.25,
          radio: deckARadio,
          speed: 1.1,
          volume: 0.7,
        },
        {
          id: DECK_B_CHANNEL_ID,
          muted: true,
          radio: deckBRadio,
          volume: 0.9,
        },
      ],
      legacyMixer: {
        crossfadePosition: 0.2,
        deckACueEnabled: true,
        deckBCueEnabled: false,
        headphoneVolume: 0.6,
        masterVolume: 0.8,
      },
    });

    const deckA = session.channels.find((channel) => channel.id === "deck-a");
    const deckB = session.channels.find((channel) => channel.id === "deck-b");

    expect(session.id).toBe("dj");
    expect(session.crossfadePosition).toBe(0.2);
    expect(session.masterVolume).toBe(0.8);
    expect(session.headphoneVolume).toBe(0.6);
    expect(deckA?.radio).toEqual(deckARadio);
    expect(deckA?.volume).toBe(0.7);
    expect(deckA?.pan).toBe(-0.25);
    expect(deckA?.speed).toBe(1.1);
    expect(deckA?.cueEnabled).toBe(true);
    expect(deckB?.radio).toEqual(deckBRadio);
    expect(deckB?.volume).toBe(0.9);
    expect(deckB?.muted).toBe(true);
    expect(deckB?.cueEnabled).toBe(false);
  });

  test("reloads deck effects in persisted order", () => {
    const delay = createDefaultEffectConfig("delay", "delay-1", 2);
    const limiter = createDefaultEffectConfig("limiter", "limiter-1", 0);
    const crusher = createDefaultEffectConfig("crusher", "crusher-1", 1);

    const session = buildDjSessionFromLegacyState({
      legacyDecks: [
        {
          effects: [delay, limiter, crusher],
          id: DECK_A_CHANNEL_ID,
        },
      ],
    });

    const deckA = session.channels.find((channel) => channel.id === "deck-a");
    expect(deckA?.effects.map((effect) => effect.id)).toEqual([
      "limiter-1",
      "crusher-1",
      "delay-1",
    ]);
    expect(deckA?.effects.map((effect) => effect.order)).toEqual([0, 1, 2]);
  });
});

describe("effect session migration", () => {
  test("adds the default tempo without changing a legacy flat chain", () => {
    const delay = createDefaultEffectConfig("delay", "delay-1", 1);
    const limiter = createDefaultEffectConfig("limiter", "limiter-1", 0);
    const channel = createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a");

    const migrated = parsePlaybackSessionRecord({
      channels: [{ ...channel, effects: [delay, limiter] }],
      id: "dj",
    });

    expect(migrated.tempo).toBe(120);
    expect(
      migrated.channels[0]?.effects.map(({ id, order }) => [id, order])
    ).toEqual([
      ["limiter-1", 0],
      ["delay-1", 1],
    ]);
  });

  test("round-trips a nested composite tree and sidechain reference", () => {
    const channel = createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a");
    const nestedGate = {
      attack: 1,
      dryWet: 1,
      enabled: true,
      floor: -60,
      hold: 10,
      id: "gate-1",
      inputGain: 1,
      inverse: false,
      order: 0,
      outputGain: 1,
      release: 100,
      sidechain: { channelId: DECK_B_CHANNEL_ID },
      threshold: -24,
      type: "gate" as const,
    };
    const composite = {
      chains: [
        {
          effects: [nestedGate],
          gain: 1,
          id: "parallel-1",
          muted: false,
          name: "Parallel 1",
          order: 0,
          pan: 0,
          solo: false,
        },
      ],
      dryWet: 1,
      enabled: true,
      id: "composite-1",
      inputGain: 1,
      order: 0,
      outputGain: 1,
      type: "fxComposite" as const,
    };

    const original = parsePlaybackSessionRecord({
      channels: [{ ...channel, effects: [composite] }],
      id: "dj",
      tempo: 128,
    });
    const restored = parsePlaybackSessionRecord(
      JSON.parse(JSON.stringify(original))
    );

    expect(restored).toEqual(original);
    expect(
      restored.channels[0]?.effects[0]?.type === "fxComposite"
        ? restored.channels[0].effects[0].chains[0]?.effects[0]?.sidechain
        : null
    ).toEqual({ channelId: DECK_B_CHANNEL_ID });
  });

  test("round-trips a three-band Frequency Split", () => {
    const channel = createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a");
    const split = createDefaultEffectConfig(
      "frequencySplit",
      "frequency-split-1",
      0
    );
    split.frequencyBandCount = 3;
    split.chains = split.chains.slice(0, 3).map((chain, order) => ({
      ...chain,
      name: ["Low", "Mid", "High"][order] ?? chain.name,
      order,
    }));
    split.crossoverFrequencies = [200, 1000];

    const restored = parsePlaybackSessionRecord({
      channels: [{ ...channel, effects: [split] }],
      id: "dj",
    }).channels[0]?.effects[0];

    expect(restored).toMatchObject({
      crossoverFrequencies: [200, 1000],
      frequencyBandCount: 3,
      type: "frequencySplit",
    });
    expect(restored?.type === "frequencySplit" && restored.chains).toHaveLength(
      3
    );
  });
});

describe("buildMultipleSessionFromRadios", () => {
  test("creates one multiple-mode channel per enabled radio in order", () => {
    const session = buildMultipleSessionFromRadios([
      {
        enabled: false,
        id: "radio-2",
        name: "Disabled",
        order: 0,
        streamUrl: "https://radio.example/disabled.mp3",
      },
      {
        enabled: true,
        id: "radio-3",
        name: "Second",
        order: 2,
        streamUrl: "https://radio.example/second.mp3",
      },
      {
        enabled: true,
        id: "radio-1",
        name: "First",
        order: 1,
        streamUrl: "https://radio.example/first.mp3",
      },
    ]);

    expect(session.id).toBe("multiple");
    expect(session.channels.map((channel) => channel.radio?.name)).toEqual([
      "First",
      "Second",
    ]);
    expect(session.channels.map((channel) => channel.id)).toEqual([
      "multi:radio-1",
      "multi:radio-3",
    ]);
  });
});

const KEXP_RADIO = {
  id: "kexp",
  name: "KEXP",
  streamUrl: "https://radio.example/kexp.mp3",
};
const TALK_RADIO = {
  id: "talk",
  name: "Talk FM",
  streamUrl: "https://radio.example/talk.mp3",
};

/** KEXP through a Compressor keyed by Talk FM, both into Speakers. */
function createDuckGraph(): NodeGraphInput {
  return {
    edges: [
      {
        id: "kexp->comp",
        source: "src-kexp",
        sourceHandle: "out:audio:main",
        target: "comp",
        targetHandle: "in:audio:main",
      },
      {
        id: "talk->comp",
        source: "src-talk",
        sourceHandle: "out:audio:main",
        target: "comp",
        targetHandle: "in:sidechain:key",
      },
      {
        id: "comp->speakers",
        source: "comp",
        sourceHandle: "out:audio:main",
        target: "speakers",
        targetHandle: "in:audio:main",
      },
      {
        gain: 0.5,
        id: "talk->speakers",
        source: "src-talk",
        sourceHandle: "out:audio:main",
        target: "speakers",
        targetHandle: "in:audio:main",
      },
    ],
    nodes: [
      {
        data: { radio: KEXP_RADIO, volume: 0.8 },
        id: "src-kexp",
        position: { x: 0, y: 0 },
        type: "station",
      },
      {
        data: { radio: TALK_RADIO },
        id: "src-talk",
        position: { x: 0, y: 112 },
        type: "station",
      },
      {
        data: { effect: createNodeEffectConfig("compressor", "comp") },
        id: "comp",
        position: { x: 240, y: 0 },
        type: "compressor",
      },
      { id: "speakers", position: { x: 480, y: 56 }, type: "speakers" },
    ],
    version: 1,
  };
}

/** The derived channel cache: one `n:*` lane per station node. */
function createDuckChannels() {
  const compressor = createNodeEffectConfig("compressor", "comp");
  compressor.sidechain = { channelId: getNodeChannelId("src-talk") };
  return [
    {
      ...createDefaultChannel(getNodeChannelId("src-kexp"), "node", 0),
      effects: [compressor],
      radio: KEXP_RADIO,
      volume: 0.8,
    },
    {
      ...createDefaultChannel(getNodeChannelId("src-talk"), "node", 1),
      radio: TALK_RADIO,
    },
  ];
}

describe("node session persistence", () => {
  test("names lanes the way the graph compiler does", () => {
    expect(getNodeChannelId("src-kexp")).toBe("n:src-kexp");
    expect(getNodeChannelId("src-kexp")).toBe(laneChannelId("src-kexp"));
    expect(laneSoundId("src-kexp")).toBe(
      `node:${getNodeChannelId("src-kexp")}`
    );
  });

  test("inserts a node session with a graph and later updates it", async () => {
    await playbackSessionsCollection.stateWhenReady();

    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: createDuckChannels(),
      crossfadePosition: 0.5,
      graph: createDuckGraph(),
      headphoneVolume: 1,
      id: "node",
      masterVolume: 0.9,
    });

    const inserted = getPlaybackSession("node");
    expect(inserted?.graph?.nodes.map((node) => node.id)).toEqual([
      "src-kexp",
      "src-talk",
      "comp",
      "speakers",
    ]);
    expect(inserted?.graph?.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(inserted?.channels.map((channel) => channel.role)).toEqual([
      "node",
      "node",
    ]);
    expect(inserted?.channels[0]?.effects[0]?.sidechain).toEqual({
      channelId: "n:src-talk",
    });

    // Every update re-validates the merged record, graph included.
    expect(() =>
      updatePlaybackSession("node", (draft) => {
        const [lane] = draft.channels;
        const station = draft.graph?.nodes.find(
          (node) => node.id === "src-kexp"
        );
        if (!(lane && station)) {
          throw new Error("Expected seeded node lane and station");
        }
        lane.volume = 0.3;
        station.position = { x: 24, y: 48 };
        draft.masterVolume = 0.5;
      })
    ).not.toThrow();
    expect(() =>
      updatePlaybackChannel("node", "n:src-talk", (draft) => {
        draft.muted = true;
      })
    ).not.toThrow();

    const updated = getPlaybackSession("node");
    expect(updated?.channels[0]?.volume).toBe(0.3);
    expect(updated?.channels[1]?.muted).toBe(true);
    expect(updated?.masterVolume).toBe(0.5);
    expect(updated?.graph?.nodes[0]?.position).toEqual({ x: 24, y: 48 });
    expect(updated?.graph?.edges).toHaveLength(4);
  });

  test("keeps a NAM model that only an unwired graph FX node uses", async () => {
    await playbackSessionsCollection.stateWhenReady();
    const graphOnlyId = createLocalNamModelId();
    await saveNamModel(graphOnlyId, '{"graphOnly":true}');
    const amp = createNodeEffectConfig("neuralAmp", "amp");
    amp.modelId = graphOnlyId;
    const graph = createDuckGraph();
    graph.nodes.push({
      data: { effect: amp },
      id: "amp",
      position: { x: 240, y: 224 },
      type: "neuralAmp",
    });

    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: createDuckChannels(),
      crossfadePosition: 0.5,
      graph,
      headphoneVolume: 1,
      id: "node",
      masterVolume: 1,
    });

    // The amp reaches no lane, so only the graph references its model.
    updatePlaybackChannel("node", "n:src-kexp", (draft) => {
      draft.effects = [];
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(getCachedNamModel(graphOnlyId)).toBe('{"graphOnly":true}');

    updatePlaybackSession("node", (draft) => {
      if (draft.graph) {
        draft.graph.nodes = draft.graph.nodes.filter(
          (node) => node.id !== "amp"
        );
      }
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(getCachedNamModel(graphOnlyId)).toBeNull();
  });

  test("keeps a node session without a graph valid", () => {
    const session = parsePlaybackSessionRecord({
      channels: [],
      id: "node",
    });
    expect(session.graph).toBeUndefined();
  });

  test("refuses a node session whose graph is malformed", () => {
    const graph = createDuckGraph();
    graph.edges.push({
      id: "ghost->speakers",
      source: "ghost",
      sourceHandle: "out:audio:main",
      target: "speakers",
      targetHandle: "in:audio:main",
    });
    expect(() =>
      parsePlaybackSessionRecord({ channels: [], graph, id: "node" })
    ).toThrow();
  });

  test("still validates a multiple session", () => {
    const session = parsePlaybackSessionRecord({
      channels: [
        {
          ...createDefaultChannel("multi:radio-1", "multiple", 0),
          radio: KEXP_RADIO,
        },
      ],
      id: "multiple",
    });
    expect(session.id).toBe("multiple");
    expect(session.channels[0]?.role).toBe("multiple");
    expect(session.graph).toBeUndefined();
  });
});

describe("multiple session persistence", () => {
  test("updatePlaybackSession updates nested channel state and session fields", async () => {
    await playbackSessionsCollection.stateWhenReady();

    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [
        {
          ...createDefaultChannel("multi:radio-1", "multiple", 0),
          radio: {
            id: "radio-1",
            name: "Radio One",
            streamUrl: "https://radio.example/one.mp3",
          },
        },
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "multiple",
      masterVolume: 1,
    });

    updatePlaybackSession("multiple", (draft) => {
      const [channel] = draft.channels;
      if (!channel) {
        throw new Error("Expected seeded multiple channel");
      }
      channel.volume = 0.25;
      draft.masterVolume = 0.75;
    });

    const session = getPlaybackSession("multiple");
    expect(session?.channels[0]?.volume).toBe(0.25);
    expect(session?.masterVolume).toBe(0.75);
  });

  test("initializePlaybackSessions preserves a stored multiple session", async () => {
    await Promise.all([
      playbackSessionsCollection.stateWhenReady(),
      radiosCollection.stateWhenReady(),
      settingsCollection.stateWhenReady(),
    ]);

    radiosCollection.insert({
      enabled: true,
      id: "radio-1",
      isSystem: false,
      name: "Persisted",
      order: 0,
      streamUrl: "https://radio.example/persisted.mp3",
    });

    settingsCollection.insert({
      id: SETTINGS_ID,
      player: {
        mode: "multiple",
        restoreStateOnLoad: true,
      },
    });

    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [
        {
          ...createDefaultChannel("multi:radio-1", "multiple", 0),
          muted: true,
          radio: {
            id: "radio-1",
            name: "Persisted",
            streamUrl: "https://radio.example/persisted.mp3",
          },
          volume: 0.44,
        },
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 0.7,
      id: "multiple",
      masterVolume: 0.23,
    });

    await initializePlaybackSessions();

    const multipleSession = getPlaybackSession("multiple");
    expect(multipleSession?.masterVolume).toBe(0.23);
    expect(multipleSession?.headphoneVolume).toBe(0.7);
    expect(multipleSession?.channels[0]?.volume).toBe(0.44);
    expect(multipleSession?.channels[0]?.muted).toBe(true);
    expect(getPlaybackSession("single")).toBeDefined();
    expect(getPlaybackSession("dj")).toBeDefined();
  });

  test("initializePlaybackSessions prunes stale session-only radios from the multiple session", async () => {
    await Promise.all([
      playbackSessionsCollection.stateWhenReady(),
      settingsCollection.stateWhenReady(),
    ]);

    settingsCollection.insert({
      id: SETTINGS_ID,
      player: {
        mode: "multiple",
        restoreStateOnLoad: true,
      },
    });

    playbackSessionsCollection.insert({
      activeChannelId: "multi:rg_hidden",
      channels: [
        {
          ...createDefaultChannel("multi:radio-1", "multiple", 0),
          radio: {
            id: "radio-1",
            name: "Saved Radio",
            streamUrl: "https://radio.example/saved.mp3",
          },
        },
        {
          ...createDefaultChannel("multi:rg_hidden", "multiple", 1),
          radio: {
            id: "rg_hidden",
            name: "Hidden Session Radio",
            streamUrl: "https://radio.example/hidden.mp3",
          },
          volume: 0.5,
        },
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "multiple",
      masterVolume: 0.4,
    });

    await initializePlaybackSessions();

    const multipleSession = getPlaybackSession("multiple");
    expect(
      multipleSession?.channels.map((channel) => channel.radio?.id)
    ).toEqual(["radio-1"]);
    expect(multipleSession?.activeChannelId).toBeNull();
  });

  test("initializePlaybackSessions preserves current session-only radios when session storage still has them", async () => {
    await Promise.all([
      playbackSessionsCollection.stateWhenReady(),
      settingsCollection.stateWhenReady(),
    ]);

    settingsCollection.insert({
      id: SETTINGS_ID,
      player: {
        mode: "multiple",
        restoreStateOnLoad: true,
      },
    });

    addSessionRadio({
      id: "rg_live",
      name: "Live Session Radio",
      streamUrl: "https://radio.example/live.mp3",
    });

    playbackSessionsCollection.insert({
      activeChannelId: "multi:rg_live",
      channels: [
        {
          ...createDefaultChannel("multi:rg_live", "multiple", 0),
          radio: {
            id: "rg_live",
            name: "Live Session Radio",
            streamUrl: "https://radio.example/live.mp3",
          },
          volume: 0.33,
        },
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "multiple",
      masterVolume: 0.4,
    });

    await initializePlaybackSessions();

    const multipleSession = getPlaybackSession("multiple");
    expect(multipleSession?.channels).toHaveLength(1);
    expect(multipleSession?.channels[0]?.radio?.id).toBe("rg_live");
    expect(multipleSession?.activeChannelId).toBe("multi:rg_live");
  });

  test("initializePlaybackSessions resets stored sessions when restore is disabled", async () => {
    await Promise.all([
      playbackSessionsCollection.stateWhenReady(),
      radiosCollection.stateWhenReady(),
      settingsCollection.stateWhenReady(),
    ]);

    radiosCollection.insert({
      enabled: true,
      id: "saved-radio-1",
      isSystem: false,
      name: "Saved Radio",
      order: 0,
      streamUrl: "https://radio.example/saved.mp3",
    });

    settingsCollection.insert({
      id: SETTINGS_ID,
      player: {
        mode: "multiple",
        restoreStateOnLoad: false,
      },
    });

    const discardedModelId = createLocalNamModelId();
    await saveNamModel(discardedModelId, '{"stored":true}');
    const discardedModel = createDefaultEffectConfig(
      "neuralAmp",
      "discarded-model",
      0
    );
    discardedModel.modelId = discardedModelId;
    discardedModel.modelData = '{"inline":true}';

    playbackSessionsCollection.insert({
      activeChannelId: SINGLE_ACTIVE_CHANNEL_ID,
      channels: [
        {
          ...createDefaultChannel(
            SINGLE_ACTIVE_CHANNEL_ID,
            "single-primary",
            0
          ),
          effects: [discardedModel],
          radio: {
            id: "single-radio",
            name: "Persisted Single",
            streamUrl: "https://radio.example/single.mp3",
          },
          volume: 0.25,
        },
        createDefaultChannel("single-b", "single-secondary", 1),
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "single",
      masterVolume: 0.6,
    });

    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [
        {
          ...createDefaultChannel("multi:session-only", "multiple", 0),
          muted: true,
          radio: {
            id: "session-only",
            name: "Session Only",
            streamUrl: "https://radio.example/session-only.mp3",
          },
          volume: 0.11,
        },
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 0.7,
      id: "multiple",
      masterVolume: 0.23,
    });

    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [
        {
          ...createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a", 0),
          cueEnabled: true,
          radio: {
            id: "deck-a-radio",
            name: "Deck A Radio",
            streamUrl: "https://radio.example/deck-a.mp3",
          },
          volume: 0.8,
        },
        {
          ...createDefaultChannel(DECK_B_CHANNEL_ID, "deck-b", 1),
          muted: true,
          radio: {
            id: "deck-b-radio",
            name: "Deck B Radio",
            streamUrl: "https://radio.example/deck-b.mp3",
          },
        },
      ],
      crossfadePosition: 0.2,
      headphoneVolume: 0.3,
      id: "dj",
      masterVolume: 0.4,
    });

    await initializePlaybackSessions();

    const singleSession = getPlaybackSession("single");
    expect(singleSession?.activeChannelId).toBeNull();
    expect(singleSession?.channels[0]?.radio).toBeNull();
    expect(singleSession?.channels[0]?.volume).toBe(1);

    const multipleSession = getPlaybackSession("multiple");
    expect(multipleSession?.masterVolume).toBe(1);
    expect(multipleSession?.channels).toHaveLength(1);
    expect(multipleSession?.channels[0]?.id).toBe("multi:saved-radio-1");
    expect(multipleSession?.channels[0]?.radio?.id).toBe("saved-radio-1");
    expect(multipleSession?.channels[0]?.volume).toBe(1);
    expect(multipleSession?.channels[0]?.muted).toBe(false);

    const djSession = getPlaybackSession("dj");
    const deckA = djSession?.channels.find(
      (channel) => channel.id === DECK_A_CHANNEL_ID
    );
    const deckB = djSession?.channels.find(
      (channel) => channel.id === DECK_B_CHANNEL_ID
    );
    expect(djSession?.masterVolume).toBe(1);
    expect(djSession?.crossfadePosition).toBe(0.5);
    expect(djSession?.headphoneVolume).toBe(1);
    expect(deckA?.radio).toBeNull();
    expect(deckA?.cueEnabled).toBe(false);
    expect(deckB?.radio).toBeNull();
    expect(deckB?.muted).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(getCachedNamModel(discardedModelId)).toBeNull();
  });
});
