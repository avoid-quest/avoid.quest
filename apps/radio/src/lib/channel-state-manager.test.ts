import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { shallow } from "@tanstack/react-store";
import { AudioManager, createDefaultEffectConfig } from "@/lib/audio";
import {
  createDefaultChannel,
  getPlaybackChannel,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import {
  initialChannelRuntimeState,
  setPlaybackChannelSoundId,
} from "@/lib/stores/playback-runtime-store";
import type { DesiredEffectsState } from "./channel-effects";
import {
  activateChannel,
  deactivateAllChannels,
  selectChannelRuntimeView,
  setChannelVolume,
} from "./channel-state-manager";

async function resetPlaybackSessions(): Promise<void> {
  await playbackSessionsCollection.stateWhenReady();
  for (const sessionId of playbackSessionsCollection.state.keys()) {
    playbackSessionsCollection.delete(sessionId);
  }
}

beforeEach(async () => {
  deactivateAllChannels();
  await resetPlaybackSessions();
});

afterEach(async () => {
  deactivateAllChannels();
  await resetPlaybackSessions();
  AudioManager.resetInstance();
});

describe("channel state manager", () => {
  test("leaves meter-rate peak levels out of the channel view", () => {
    const playing = {
      ...initialChannelRuntimeState,
      isPlaying: true,
      soundId: "left_station-1:1",
    };
    const view = selectChannelRuntimeView(playing);

    expect(view).not.toHaveProperty("peakLevel");
    expect(
      shallow(
        view,
        selectChannelRuntimeView({
          ...playing,
          peakLevel: { left: 0.8, right: 0.6 },
        })
      )
    ).toBeTrue();
    expect(
      shallow(view, selectChannelRuntimeView({ ...playing, isBuffering: true }))
    ).toBeFalse();
  });

  test("does not expose an alternate Effects mutation interface", async () => {
    const channelStateManager = await import("./channel-state-manager");
    const alternateEffectsMutations = [
      "updateChannel",
      "setChannelEffectsDryWet",
      "setSessionEffectsTempo",
      "addChannelEffect",
      "createAndAddChannelEffect",
      "addChannelEffectToChain",
      "createAndAddChannelEffectToChain",
      "updateChannelEffect",
      "removeChannelEffect",
      "reorderChannelEffectChain",
      "reorderChannelEffects",
    ];

    expect(
      alternateEffectsMutations.filter((name) => name in channelStateManager)
    ).toEqual([]);
  });

  test("persists volume updates and syncs the active audio sound", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      activeChannelId: "single-a",
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
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "single",
      masterVolume: 1,
    });

    const manager = AudioManager.getInstance();
    const setVolume = mock((_soundId: string, _volume: number) => undefined);
    manager.setVolume = setVolume;
    setPlaybackChannelSoundId("single-a", "sound-1");

    setChannelVolume("single", "single-a", 0.42);

    expect(getPlaybackChannel("single", "single-a")?.volume).toBe(0.42);
    expect(setVolume).toHaveBeenCalledWith("sound-1", 0.42);
  });

  test("binds the persisted desired Effects state during Channel activation", async () => {
    await playbackSessionsCollection.stateWhenReady();
    const effect = createDefaultEffectConfig("delay", "delay", 0);
    effect.enabled = true;
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [
        {
          ...createDefaultChannel("deck-a", "deck-a", 0),
          effects: [effect],
          effectsDryWet: 0.6,
        },
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "dj",
      masterVolume: 1,
      tempo: 126,
    });
    const manager = AudioManager.getInstance();
    const desired: DesiredEffectsState[] = [];
    manager.createSound = mock((_radio, soundId) => soundId ?? "sound-a");
    manager.subscribe = mock(() => () => undefined);
    manager.subscribeMeter = mock(() => () => undefined);
    manager.cleanupSound = mock(() => undefined);
    manager.reconcileEffects = mock((_soundId, state) => {
      desired.push(state);
      return Promise.resolve({
        backend: null,
        ready: false,
        status: "inactive" as const,
      });
    });

    activateChannel(
      "dj",
      "deck-a",
      {
        id: "radio-a",
        name: "Deck A",
        streamUrl: "https://radio.example/a.mp3",
      },
      { soundId: "sound-a" }
    );
    await Promise.resolve();

    expect(desired.at(-1)).toEqual({
      dryWet: 0.6,
      sidechainSoundId: null,
      tempo: 126,
      tree: [effect],
    });
  });
});
