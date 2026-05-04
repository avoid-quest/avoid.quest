import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { AudioManager } from "@/lib/audio";
import {
  createDefaultChannel,
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  getPlaybackChannel,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { getPlaybackChannelRuntime } from "@/lib/stores/playback-runtime-store";
import {
  activateChannel,
  deactivateAllChannels,
  deactivateChannel,
} from "./channel-state-manager";
import { setDeckRadioSource } from "./dj-actions-deck-load";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
}

function insertDjSession() {
  playbackSessionsCollection.insert({
    id: "dj",
    channels: [
      createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a", 0),
      createDefaultChannel(DECK_B_CHANNEL_ID, "deck-b", 1),
    ],
    masterVolume: 1,
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    activeChannelId: null,
  });
}

function createDependencies() {
  return {
    activateChannel,
    applyCrossfade: mock(() => undefined),
    applyStoredChannelStrip: mock(() => undefined),
    applyStoredEffectsAndFilters: mock(async () => undefined),
    clearDjError: mock(() => undefined),
    connectDeckCueBus: mock(() => undefined),
    deactivateChannel,
    getAudioManager: () => AudioManager.getInstance(),
    getSoundId: (radio: { id?: string | number }, side: string) =>
      `${side}_${radio.id}`,
    initializeAudioDevices: mock(async () => undefined),
    loadTrack: mock(async () => undefined),
    reportDjError: mock(() => undefined),
    resolveStreamUrl: mock(async () => null),
  };
}

beforeEach(async () => {
  await resetPlaybackSessions();
  deactivateAllChannels();
  AudioManager.resetInstance();
});

afterEach(async () => {
  await resetPlaybackSessions();
  deactivateAllChannels();
  AudioManager.resetInstance();
});

describe("DJ deck channel lifecycle", () => {
  test("loads, replaces, and ejects a deck through channel lifecycle cleanup", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    const firstCleanup = mock(() => undefined);
    const secondCleanup = mock(() => undefined);
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((soundId, _callback) =>
      soundId === "left_station-1" ? firstCleanup : secondCleanup
    );
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();

    await setDeckRadioSource(
      "deck-a",
      {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      dependencies
    );
    await setDeckRadioSource(
      "deck-a",
      {
        id: "station-2",
        name: "Station 2",
        streamUrl: "https://radio.example/two.mp3",
      },
      dependencies
    );
    await setDeckRadioSource("deck-a", null, dependencies);

    expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(secondCleanup).toHaveBeenCalledTimes(1);
    expect(manager.cleanupSound).toHaveBeenNthCalledWith(1, "left_station-1");
    expect(manager.cleanupSound).toHaveBeenNthCalledWith(2, "left_station-2");
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBeNull();
    expect(getPlaybackChannel("dj", "deck-a")?.radio).toBeNull();
  });

  test("does not persist a new deck radio when sound activation fails", async () => {
    await playbackSessionsCollection.stateWhenReady();
    insertDjSession();

    const manager = AudioManager.getInstance();
    manager.createSound = mock(() => {
      throw new Error("create failed");
    });
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => mock(() => undefined));
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );
    const dependencies = createDependencies();

    await setDeckRadioSource(
      "deck-a",
      {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/one.mp3",
      },
      dependencies
    );

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toBeNull();
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBeNull();
    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      "Failed to load deck-a",
      "DJ_LOAD_DECK_FAILED",
      expect.any(Error),
      expect.objectContaining({ id: "station-1" })
    );
  });
});
