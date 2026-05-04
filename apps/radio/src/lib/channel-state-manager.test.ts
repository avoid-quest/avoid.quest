import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { AudioManager, createDefaultEffectConfig } from "@/lib/audio";
import {
  createDefaultChannel,
  getPlaybackChannel,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { setPlaybackChannelSoundId } from "@/lib/stores/playback-runtime-store";
import {
  activateChannel,
  addChannelEffect,
  deactivateAllChannels,
  deactivateChannel,
  reorderChannelEffects,
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
  deactivateAllChannels();
});

afterEach(async () => {
  await resetPlaybackSessions();
  deactivateAllChannels();
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

  test("runs activation state handlers from the lifecycle-owned subscription", () => {
    const manager = AudioManager.getInstance();
    const cleanup = mock(() => undefined);
    const onAudioState = mock(() => undefined);
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, callback) => {
      callback({
        error: null,
        hasEnded: false,
        isBuffering: false,
        isLoading: false,
        isPlaying: true,
        volume: 1,
      });
      return cleanup;
    });
    manager.subscribeMeter = mock((_soundId, _callback) => cleanup);

    activateChannel(
      "dj",
      "deck-a",
      {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/station.mp3",
      },
      {
        onAudioState,
        soundId: "sound-1",
      }
    );

    expect(onAudioState).toHaveBeenCalledWith(
      expect.objectContaining({ isPlaying: true })
    );
  });

  test("owns effect order assignment when effects are added", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      id: "dj",
      channels: [createDefaultChannel("deck-a", "deck-a", 0)],
      masterVolume: 1,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: null,
    });

    const delay = createDefaultEffectConfig("delay", "delay-1", 99);
    const limiter = createDefaultEffectConfig("limiter", "limiter-1", 99);

    addChannelEffect("dj", "deck-a", delay);
    addChannelEffect("dj", "deck-a", limiter);

    const effects = getPlaybackChannel("dj", "deck-a")?.effects ?? [];
    expect(effects.map((effect) => effect.id)).toEqual([
      "delay-1",
      "limiter-1",
    ]);
    expect(effects.map((effect) => effect.order)).toEqual([0, 1]);
  });

  test("serializes persisted effect order before syncing reorder commands", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      id: "dj",
      channels: [createDefaultChannel("deck-a", "deck-a", 0)],
      masterVolume: 1,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: null,
    });

    const delay = createDefaultEffectConfig("delay", "delay-1", 99);
    const limiter = createDefaultEffectConfig("limiter", "limiter-1", 99);
    const crusher = createDefaultEffectConfig("crusher", "crusher-1", 99);
    const manager = AudioManager.getInstance();
    manager.reorderEffects = mock(
      (_soundId: string, _effectIds: string[]) => undefined
    );
    setPlaybackChannelSoundId("deck-a", "sound-1");

    addChannelEffect("dj", "deck-a", delay);
    addChannelEffect("dj", "deck-a", limiter);
    addChannelEffect("dj", "deck-a", crusher);
    reorderChannelEffects("dj", "deck-a", [
      "crusher-1",
      "missing-effect",
      "delay-1",
    ]);

    const effects = getPlaybackChannel("dj", "deck-a")?.effects ?? [];
    expect(effects.map((effect) => effect.id)).toEqual([
      "crusher-1",
      "delay-1",
      "limiter-1",
    ]);
    expect(effects.map((effect) => effect.order)).toEqual([0, 1, 2]);
    expect(manager.reorderEffects).toHaveBeenCalledWith("sound-1", [
      "crusher-1",
      "delay-1",
      "limiter-1",
    ]);
  });

  test("skips audio reorder sync when the persisted channel is missing", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      id: "dj",
      channels: [createDefaultChannel("deck-b", "deck-b", 1)],
      masterVolume: 1,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: null,
    });

    const manager = AudioManager.getInstance();
    manager.reorderEffects = mock(
      (_soundId: string, _effectIds: string[]) => undefined
    );
    setPlaybackChannelSoundId("deck-a", "sound-1");

    reorderChannelEffects("dj", "deck-a", ["delay-1"]);

    expect(manager.reorderEffects).not.toHaveBeenCalled();
  });
});
