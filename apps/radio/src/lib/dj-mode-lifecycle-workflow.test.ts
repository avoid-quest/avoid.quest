import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioEngineFacade, AudioManager, Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  getPlaybackChannel,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import {
  getDjError,
  resetAllDjRuntime,
  setDjError,
} from "@/lib/stores/dj-runtime-store";
import {
  getPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { createDjModeLifecycleWorkflow } from "./dj-mode-lifecycle-workflow";
import type { PlaybackActionContext } from "./playback-action-context";

type ChannelActivationSoundIdOption = string | { soundId?: string };

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
}

function getActivatedSoundId(
  channelId: string,
  optionsOrSoundId?: ChannelActivationSoundIdOption
): string {
  if (typeof optionsOrSoundId === "string") {
    return optionsOrSoundId;
  }
  return optionsOrSoundId?.soundId ?? `sound:${channelId}`;
}

function createTestContext() {
  const audioEngine = {
    playback: {
      play: mock(async (_soundId: string, _volume?: number) => undefined),
      pause: mock((_soundId: string) => undefined),
      seek: mock((_soundId: string, _position: number) => undefined),
      refreshStreamUrl: mock(
        async (_soundId: string, _newUrl: string, _seekPosition?: number) =>
          undefined
      ),
    },
    volume: {
      setChannelVolume: mock((_soundId: string, _volume: number) => undefined),
      setMasterVolume: mock((_volume: number) => undefined),
    },
  } satisfies AudioEngineFacade;

  return {
    audio: {
      hasSound: mock((_soundId: string) => false),
      pauseSound: mock((_soundId: string) => undefined),
      playSound: mock(async (_soundId: string, _volume: number) => undefined),
      setGlobalVolume: mock((_volume: number) => undefined),
      setMainDelay: mock((_delayMs: number) => undefined),
      setVolume: mock((_soundId: string, _volume: number) => undefined),
    } as unknown as AudioManager,
    audioEngine,
    channels: {
      activate: mock(
        (
          _sessionId,
          channelId,
          _radio,
          optionsOrSoundId?: ChannelActivationSoundIdOption
        ) => {
          const soundId = getActivatedSoundId(channelId, optionsOrSoundId);
          setPlaybackChannelRuntime(channelId, () => ({ soundId }));
          return soundId;
        }
      ),
      deactivateAll: mock(() => undefined),
      deactivate: mock((_channelId: string) => undefined),
      setVolume: mock((_sessionId, _channelId, _volume) => undefined),
      subscribeRuntime: mock((_sessionId, _channelId, _soundId) => undefined),
    },
    getMainOutputRouter: () => null,
    lifecycle: { mainOutputSettingsApplied: true },
    reportError: mock(() => undefined),
    resetAudioManager: mock(() => undefined),
  } satisfies PlaybackActionContext;
}

beforeEach(async () => {
  await resetPlaybackSessions();
  resetAllDjRuntime();
});

afterEach(async () => {
  await resetPlaybackSessions();
  resetAllDjRuntime();
});

describe("createDjModeLifecycleWorkflow", () => {
  test("restores only restorable decks and reapplies mixer state on activation", async () => {
    await playbackSessionsCollection.stateWhenReady();
    const streamRadio = {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/station.mp3",
    } satisfies Radio;
    const localFileRadio = {
      id: "local-1",
      name: "Local File",
      streamUrl: "blob:https://radio.example/local",
      platformMetadata: {
        platform: "local-file",
        itemType: "track",
        url: "",
        fileName: "local.mp3",
        displayName: "Local File",
        duration: 10,
        fileSize: 100,
        mimeType: "audio/mpeg",
        objectUrl: "blob:https://radio.example/local",
      },
    } satisfies Radio;
    playbackSessionsCollection.insert({
      id: "dj",
      channels: [
        {
          ...createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a", 0),
          radio: streamRadio,
          volume: 0.42,
        },
        {
          ...createDefaultChannel(DECK_B_CHANNEL_ID, "deck-b", 1),
          radio: localFileRadio,
          volume: 0.37,
        },
      ],
      masterVolume: 0.7,
      crossfadePosition: 0.25,
      headphoneVolume: 1,
      activeChannelId: null,
    });
    const context = createTestContext();
    const workflow = createDjModeLifecycleWorkflow({ ctx: context });

    await workflow.activate();

    expect(context.channels.activate).toHaveBeenCalledTimes(1);
    expect(context.channels.activate).toHaveBeenCalledWith(
      "dj",
      DECK_A_CHANNEL_ID,
      streamRadio,
      expect.objectContaining({ soundId: "left_station-1" })
    );
    expect(getPlaybackChannel("dj", DECK_B_CHANNEL_ID)?.radio).toBeNull();
    expect(context.audio.setGlobalVolume).toHaveBeenCalledWith(0.7);
    expect(context.audioEngine.volume.setMasterVolume).toHaveBeenCalledWith(
      0.7
    );
  });

  test("clears stale surfaced errors during activation even when no decks restore", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      id: "dj",
      channels: [],
      masterVolume: 0.7,
      crossfadePosition: 0.25,
      headphoneVolume: 1,
      activeChannelId: null,
    });
    setDjError("stale deck load failed");
    const context = createTestContext();
    const workflow = createDjModeLifecycleWorkflow({ ctx: context });

    await workflow.activate();

    expect(getDjError()).toBeNull();
    expect(context.channels.activate).not.toHaveBeenCalled();
  });

  test("deactivation fades deck sounds, clears runtime state, and clears surfaced errors", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      id: "dj",
      channels: [
        createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a", 0),
        createDefaultChannel(DECK_B_CHANNEL_ID, "deck-b", 1),
      ],
      masterVolume: 0.5,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: null,
    });
    setPlaybackChannelRuntime(DECK_A_CHANNEL_ID, () => ({
      soundId: "left_station-1",
      isPlaying: true,
    }));
    setPlaybackChannelRuntime(DECK_B_CHANNEL_ID, () => ({
      soundId: "right_station-2",
      isPlaying: true,
    }));
    setDjError("stale error");
    const fadeOut = mock((_soundId: string, _duration: number) =>
      Promise.resolve()
    );
    const context = createTestContext();
    const workflow = createDjModeLifecycleWorkflow({
      ctx: context,
      fadeOutSound: fadeOut,
      fadeOutDurationMs: 120,
    });

    await workflow.deactivate();

    expect(fadeOut).toHaveBeenCalledWith("left_station-1", 120, true);
    expect(fadeOut).toHaveBeenCalledWith("right_station-2", 120, true);
    expect(context.channels.deactivate).toHaveBeenCalledWith(DECK_A_CHANNEL_ID);
    expect(context.channels.deactivate).toHaveBeenCalledWith(DECK_B_CHANNEL_ID);
    expect(getPlaybackChannelRuntime(DECK_A_CHANNEL_ID).soundId).toBeNull();
    expect(getPlaybackChannelRuntime(DECK_B_CHANNEL_ID).soundId).toBeNull();
    expect(getDjError()).toBeNull();
  });
});
