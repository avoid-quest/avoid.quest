import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioEngineFacade, AudioManager, Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  playbackSessionsCollection,
  SINGLE_ACTIVE_CHANNEL_ID,
  SINGLE_STANDBY_CHANNEL_ID,
} from "@/lib/collections/playback-sessions";
import {
  getPlaybackChannelRuntime,
  resetAllPlaybackRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { createManagedPlaybackSessionWorkflow } from "./managed-playback-session-workflow";
import type { PlaybackActionContext } from "./playback-action-context";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
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
  const activate = mock(
    (
      _sessionId,
      channelId,
      _radio,
      optionsOrSoundId?: string | { soundId?: string }
    ) => {
      const soundId =
        typeof optionsOrSoundId === "string"
          ? optionsOrSoundId
          : (optionsOrSoundId?.soundId ?? `sound:${channelId}`);
      setPlaybackChannelRuntime(channelId, () => ({ soundId }));
      return soundId;
    }
  );

  return {
    audio: {
      hasSound: mock((_soundId: string) => false),
      pauseSound: mock((_soundId: string) => undefined),
      playSound: mock(async (_soundId: string, _volume: number) => undefined),
      setGlobalVolume: mock((_volume: number) => undefined),
      setMainDelay: mock((_delayMs: number) => undefined),
    } as unknown as AudioManager,
    audioEngine,
    channels: {
      activate,
      deactivateAll: mock(() => undefined),
      deactivate: mock((_channelId: string) => undefined),
      setVolume: mock((_sessionId, _channelId, _volume) => undefined),
      setMuted: mock((_sessionId, _channelId, _muted) => undefined),
      setPan: mock((_sessionId, _channelId, _pan) => undefined),
      setSpeed: mock((_sessionId, _channelId, _speed) => undefined),
      subscribeRuntime: mock((_sessionId, _channelId, _soundId) => undefined),
    },
    getMainOutputRouter: () => null,
    lifecycle: { mainOutputSettingsApplied: true },
    reportError: mock(() => undefined),
    resumeAudioContext: mock(async () => undefined),
    resetAudioManager: mock(() => undefined),
  } satisfies PlaybackActionContext;
}

beforeEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
});

afterEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
});

describe("managed playback session workflow", () => {
  test("activates single mode with only the active restorable channel", async () => {
    await playbackSessionsCollection.stateWhenReady();
    const standbyRadio = {
      id: "standby-local",
      name: "Standby Local",
      streamUrl: "blob:https://radio.example/standby",
      platformMetadata: {
        platform: "local-file",
        itemType: "track",
        url: "",
        fileName: "standby.mp3",
        displayName: "Standby",
        duration: 10,
        fileSize: 100,
        mimeType: "audio/mpeg",
        objectUrl: "blob:https://radio.example/standby",
      },
    } satisfies Radio;
    const activeRadio = {
      id: "active-station",
      name: "Active Station",
      streamUrl: "https://radio.example/active.mp3",
    } satisfies Radio;

    playbackSessionsCollection.insert({
      id: "single",
      channels: [
        {
          ...createDefaultChannel(
            SINGLE_ACTIVE_CHANNEL_ID,
            "single-primary",
            0
          ),
          radio: activeRadio,
        },
        {
          ...createDefaultChannel(
            SINGLE_STANDBY_CHANNEL_ID,
            "single-secondary",
            1
          ),
          radio: standbyRadio,
        },
      ],
      masterVolume: 0.4,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: SINGLE_ACTIVE_CHANNEL_ID,
    });
    setPlaybackChannelRuntime(SINGLE_STANDBY_CHANNEL_ID, () => ({
      soundId: "single:single-b",
      isPlaying: true,
    }));
    const context = createTestContext();
    const workflow = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });

    await workflow.activate();

    expect(context.channels.activate).toHaveBeenCalledTimes(1);
    expect(context.channels.activate).toHaveBeenCalledWith(
      "single",
      SINGLE_ACTIVE_CHANNEL_ID,
      activeRadio,
      "single:single-a"
    );
    expect(context.channels.deactivate).not.toHaveBeenCalledWith(
      SINGLE_STANDBY_CHANNEL_ID
    );
    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).soundId).toBe(
      "single:single-a"
    );
    expect(getPlaybackChannelRuntime(SINGLE_STANDBY_CHANNEL_ID).soundId).toBe(
      "single:single-b"
    );
    expect(context.audio.setGlobalVolume).toHaveBeenCalledWith(0.4);
  });

  test("activates multiple mode with only restorable stream channels", async () => {
    await playbackSessionsCollection.stateWhenReady();
    const restorableRadio = {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/station.mp3",
    } satisfies Radio;
    const radioGardenRadio = {
      id: "rg_station-1",
      name: "Garden",
      streamUrl: "https://radio.garden/api/ara/content/listen/station-1",
      platformMetadata: {
        platform: "radiogarden",
        itemType: "channel",
        url: "https://radio.garden/listen/station-1",
        channelId: "station-1",
      },
    } satisfies Radio;
    const localFileRadio = {
      id: "local-1",
      name: "Local",
      streamUrl: "blob:https://radio.example/local",
      platformMetadata: {
        platform: "local-file",
        itemType: "track",
        url: "",
        fileName: "local.mp3",
        displayName: "Local",
        duration: 10,
        fileSize: 100,
        mimeType: "audio/mpeg",
        objectUrl: "blob:https://radio.example/local",
      },
    } satisfies Radio;
    const soundCloudRadio = {
      id: "sc-1",
      name: "SoundCloud",
      streamUrl: "https://soundcloud.example/track",
      platformMetadata: {
        platform: "soundcloud",
        itemType: "track",
        url: "https://soundcloud.com/artist/track",
      },
    } satisfies Radio;

    playbackSessionsCollection.insert({
      id: "multiple",
      channels: [
        {
          ...createDefaultChannel("multi:station-1", "multiple", 0),
          radio: restorableRadio,
        },
        {
          ...createDefaultChannel("multi:rg_station-1", "multiple", 1),
          radio: radioGardenRadio,
        },
        {
          ...createDefaultChannel("multi:local-1", "multiple", 2),
          radio: localFileRadio,
        },
        {
          ...createDefaultChannel("multi:sc-1", "multiple", 3),
          radio: soundCloudRadio,
        },
      ],
      masterVolume: 0.65,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: null,
    });
    const context = createTestContext();
    const workflow = createManagedPlaybackSessionWorkflow("multiple", {
      ctx: context,
    });

    await workflow.activate();

    expect(context.channels.activate).toHaveBeenCalledTimes(2);
    expect(context.channels.activate).toHaveBeenCalledWith(
      "multiple",
      "multi:station-1",
      restorableRadio,
      "multiple:multi:station-1"
    );
    expect(context.channels.activate).toHaveBeenCalledWith(
      "multiple",
      "multi:rg_station-1",
      radioGardenRadio,
      "multiple:multi:rg_station-1"
    );
    expect(context.audio.setGlobalVolume).toHaveBeenCalledWith(0.65);
    expect(getPlaybackChannelRuntime("multi:local-1").soundId).toBeNull();
    expect(getPlaybackChannelRuntime("multi:sc-1").soundId).toBeNull();
  });

  test("cleans stale runtime for channels that cannot be restored", async () => {
    await playbackSessionsCollection.stateWhenReady();
    const localFileRadio = {
      id: "local-1",
      name: "Local",
      streamUrl: "blob:https://radio.example/local",
      platformMetadata: {
        platform: "local-file",
        itemType: "track",
        url: "",
        fileName: "local.mp3",
        displayName: "Local",
        duration: 10,
        fileSize: 100,
        mimeType: "audio/mpeg",
        objectUrl: "blob:https://radio.example/local",
      },
    } satisfies Radio;

    playbackSessionsCollection.insert({
      id: "multiple",
      channels: [
        {
          ...createDefaultChannel("multi:local-1", "multiple", 0),
          radio: localFileRadio,
        },
      ],
      masterVolume: 0.65,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: null,
    });
    setPlaybackChannelRuntime("multi:local-1", () => ({
      soundId: "multiple:multi:local-1",
      isPlaying: true,
    }));
    const context = createTestContext();
    const workflow = createManagedPlaybackSessionWorkflow("multiple", {
      ctx: context,
    });

    await workflow.activate();

    expect(context.channels.activate).not.toHaveBeenCalled();
    expect(context.channels.deactivate).toHaveBeenCalledWith("multi:local-1");
    expect(getPlaybackChannelRuntime("multi:local-1").soundId).toBeNull();
    expect(getPlaybackChannelRuntime("multi:local-1").isPlaying).toBe(false);
  });
});
