import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { addMultiplePlaybackChannel } from "../playback-actions-multiple";
import {
  buildDjSessionFromLegacyState,
  buildMultipleSessionFromRadios,
  buildSingleSessionFromLegacyState,
  createDefaultChannel,
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  getPlaybackSession,
  initializePlaybackSessions,
  playbackSessionsCollection,
  SINGLE_ACTIVE_CHANNEL_ID,
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
    get length() {
      return state.size;
    },
    clear() {
      state.clear();
    },
    getItem(key) {
      return state.get(key) ?? null;
    },
    key(index) {
      return Array.from(state.keys())[index] ?? null;
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
    value: createMemoryStorage(),
    configurable: true,
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

describe("buildDjSessionFromLegacyState", () => {
  test("preserves deck assignment and mixer values from legacy dj state", () => {
    const deckARadio = {
      id: "deck-a-radio",
      name: "Deck A",
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
          radio: deckARadio,
          volume: 0.7,
          pan: -0.25,
          speed: 1.1,
        },
        {
          id: DECK_B_CHANNEL_ID,
          radio: deckBRadio,
          volume: 0.9,
          muted: true,
        },
      ],
      legacyMixer: {
        crossfadePosition: 0.2,
        masterVolume: 0.8,
        headphoneVolume: 0.6,
        deckACueEnabled: true,
        deckBCueEnabled: false,
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
});

describe("buildMultipleSessionFromRadios", () => {
  test("creates one multiple-mode channel per enabled radio in order", () => {
    const session = buildMultipleSessionFromRadios([
      {
        id: "radio-2",
        name: "Disabled",
        streamUrl: "https://radio.example/disabled.mp3",
        enabled: false,
        order: 0,
      },
      {
        id: "radio-3",
        name: "Second",
        streamUrl: "https://radio.example/second.mp3",
        enabled: true,
        order: 2,
      },
      {
        id: "radio-1",
        name: "First",
        streamUrl: "https://radio.example/first.mp3",
        enabled: true,
        order: 1,
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

describe("multiple session persistence", () => {
  test("updatePlaybackSession persists nested channel state through the typed session mutation path", async () => {
    await playbackSessionsCollection.stateWhenReady();

    playbackSessionsCollection.insert({
      id: "multiple",
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
      masterVolume: 1,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: null,
    });

    updatePlaybackSession("multiple", (draft) => {
      const channel = draft.channels[0];
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

  test("re-adding an existing multiple channel preserves its saved state", async () => {
    await playbackSessionsCollection.stateWhenReady();

    playbackSessionsCollection.insert({
      id: "multiple",
      channels: [
        {
          ...createDefaultChannel("multi:radio-1", "multiple", 0),
          radio: {
            id: "radio-1",
            name: "Existing",
            streamUrl: "https://radio.example/existing.mp3",
          },
          volume: 0.37,
          muted: true,
          filter: {
            type: "highpass",
            frequency: 2200,
            Q: 0.8,
            gain: 0,
            enabled: true,
          },
        },
      ],
      masterVolume: 0.6,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: null,
    });

    const channel = addMultiplePlaybackChannel({
      id: "radio-1",
      name: "Existing",
      streamUrl: "https://radio.example/existing.mp3",
    });

    expect(channel.volume).toBe(0.37);
    expect(channel.muted).toBe(true);
    expect(channel.filter).toEqual({
      type: "highpass",
      frequency: 2200,
      Q: 0.8,
      gain: 0,
      enabled: true,
    });
    expect(getPlaybackSession("multiple")?.channels).toHaveLength(1);
  });

  test("initializePlaybackSessions preserves a stored multiple session", async () => {
    await Promise.all([
      playbackSessionsCollection.stateWhenReady(),
      radiosCollection.stateWhenReady(),
      settingsCollection.stateWhenReady(),
    ]);

    radiosCollection.insert({
      id: "radio-1",
      name: "Persisted",
      streamUrl: "https://radio.example/persisted.mp3",
      order: 0,
      enabled: true,
      isSystem: false,
    });

    settingsCollection.insert({
      id: SETTINGS_ID,
      player: {
        mode: "multiple",
        restoreStateOnLoad: true,
      },
    });

    playbackSessionsCollection.insert({
      id: "multiple",
      channels: [
        {
          ...createDefaultChannel("multi:radio-1", "multiple", 0),
          radio: {
            id: "radio-1",
            name: "Persisted",
            streamUrl: "https://radio.example/persisted.mp3",
          },
          volume: 0.44,
          muted: true,
        },
      ],
      masterVolume: 0.23,
      crossfadePosition: 0.5,
      headphoneVolume: 0.7,
      activeChannelId: null,
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
      id: "multiple",
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
      masterVolume: 0.4,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: "multi:rg_hidden",
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
      id: "multiple",
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
      masterVolume: 0.4,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: "multi:rg_live",
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
      id: "saved-radio-1",
      name: "Saved Radio",
      streamUrl: "https://radio.example/saved.mp3",
      order: 0,
      enabled: true,
      isSystem: false,
    });

    settingsCollection.insert({
      id: SETTINGS_ID,
      player: {
        mode: "multiple",
        restoreStateOnLoad: false,
      },
    });

    playbackSessionsCollection.insert({
      id: "single",
      channels: [
        {
          ...createDefaultChannel(
            SINGLE_ACTIVE_CHANNEL_ID,
            "single-primary",
            0
          ),
          radio: {
            id: "single-radio",
            name: "Persisted Single",
            streamUrl: "https://radio.example/single.mp3",
          },
          volume: 0.25,
        },
        createDefaultChannel("single-b", "single-secondary", 1),
      ],
      masterVolume: 0.6,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: SINGLE_ACTIVE_CHANNEL_ID,
    });

    playbackSessionsCollection.insert({
      id: "multiple",
      channels: [
        {
          ...createDefaultChannel("multi:session-only", "multiple", 0),
          radio: {
            id: "session-only",
            name: "Session Only",
            streamUrl: "https://radio.example/session-only.mp3",
          },
          volume: 0.11,
          muted: true,
        },
      ],
      masterVolume: 0.23,
      crossfadePosition: 0.5,
      headphoneVolume: 0.7,
      activeChannelId: null,
    });

    playbackSessionsCollection.insert({
      id: "dj",
      channels: [
        {
          ...createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a", 0),
          radio: {
            id: "deck-a-radio",
            name: "Deck A Radio",
            streamUrl: "https://radio.example/deck-a.mp3",
          },
          volume: 0.8,
          cueEnabled: true,
        },
        {
          ...createDefaultChannel(DECK_B_CHANNEL_ID, "deck-b", 1),
          radio: {
            id: "deck-b-radio",
            name: "Deck B Radio",
            streamUrl: "https://radio.example/deck-b.mp3",
          },
          muted: true,
        },
      ],
      masterVolume: 0.4,
      crossfadePosition: 0.2,
      headphoneVolume: 0.3,
      activeChannelId: null,
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
  });
});
