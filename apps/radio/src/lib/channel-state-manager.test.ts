import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { AudioManager } from "@/lib/audio";
import {
  createDefaultChannel,
  getPlaybackChannel,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import {
  resetAllPlaybackRuntime,
  setPlaybackChannelSoundId,
} from "@/lib/stores/playback-runtime-store";
import {
  activateChannel,
  clearAllChannelSubscriptionCleanups,
  deactivateChannel,
  setChannelVolume,
} from "./channel-state-manager";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
}

beforeEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
  clearAllChannelSubscriptionCleanups();
});

afterEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
  clearAllChannelSubscriptionCleanups();
  AudioManager.resetInstance();
});

describe("channel state manager", () => {
  test("persists volume updates and syncs the active audio sound", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      id: "single",
      channels: [
        {
          ...createDefaultChannel("single-a", "single-primary", 0),
          radio: {
            id: "station-1",
            name: "Station 1",
            streamUrl: "https://radio.example/station.mp3",
          },
        },
      ],
      masterVolume: 1,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: "single-a",
    });

    const manager = AudioManager.getInstance();
    const setVolume = mock((_soundId: string, _volume: number) => undefined);
    manager.setVolume = setVolume;
    setPlaybackChannelSoundId("single-a", "sound-1");

    setChannelVolume("single", "single-a", 0.42);

    expect(getPlaybackChannel("single", "single-a")?.volume).toBe(0.42);
    expect(setVolume).toHaveBeenCalledWith("sound-1", 0.42);
  });

  test("owns subscription cleanup when a channel is deactivated", () => {
    const manager = AudioManager.getInstance();
    const cleanup = mock(() => undefined);
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => cleanup);
    manager.subscribeMeter = mock((_soundId, _callback) => cleanup);

    activateChannel(
      "single",
      "single-a",
      {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/station.mp3",
      },
      "sound-1"
    );

    deactivateChannel("single-a");

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(manager.cleanupSound).toHaveBeenCalledWith("sound-1");
  });
});
