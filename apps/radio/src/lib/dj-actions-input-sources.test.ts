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
import { deactivateAllChannels } from "./channel-state-manager";
import { setDeckDeviceInputSource } from "./dj-actions-input-sources";

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
    applyCrossfade: mock(() => undefined),
    applyStoredChannelStrip: mock(() => undefined),
    applyStoredEffectsAndFilters: mock(async () => undefined),
    clearDjError: mock(() => undefined),
    connectDeckCueBus: mock(() => undefined),
    getAudioManager: () => AudioManager.getInstance(),
    initializeAudioDevices: mock(async () => undefined),
    reportDjError: mock(() => undefined),
    setDeckRadio: mock(async () => undefined),
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

describe("DJ device input lifecycle", () => {
  test("does not persist a device radio when sound activation fails", async () => {
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

    await setDeckDeviceInputSource(
      "deck-a",
      "device-1",
      "Device 1",
      dependencies
    );

    expect(getPlaybackChannel("dj", "deck-a")?.radio).toBeNull();
    expect(getPlaybackChannelRuntime("deck-a").soundId).toBeNull();
    expect(dependencies.reportDjError).toHaveBeenCalledWith(
      "create failed",
      "DJ_DEVICE_INPUT_START_FAILED",
      expect.any(Error),
      expect.objectContaining({ id: "device-input-left" })
    );
  });
});
