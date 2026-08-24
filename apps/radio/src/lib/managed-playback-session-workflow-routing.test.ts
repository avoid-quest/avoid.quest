import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioEngineFacade, AudioManager } from "@/lib/audio";
import {
  createDefaultChannel,
  getPlaybackSession,
  playbackSessionsCollection,
  SINGLE_ACTIVE_CHANNEL_ID,
} from "@/lib/collections/playback-sessions";
import { setMainDelayMs, settingsCollection } from "@/lib/collections/settings";
import {
  resetAllPlaybackRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { createManagedPlaybackSessionWorkflow } from "./managed-playback-session-workflow";
import type { PlaybackActionContext } from "./playback-action-context";

const originalAudio = globalThis.Audio;

function setAudioConstructor(AudioConstructor: new () => { volume: number }) {
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: AudioConstructor,
    writable: true,
  });
}

async function resetCollections() {
  await Promise.all([
    playbackSessionsCollection.stateWhenReady(),
    settingsCollection.stateWhenReady(),
  ]);
  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
  for (const settingsId of Array.from(settingsCollection.state.keys())) {
    settingsCollection.delete(settingsId);
  }
}

function insertAudioSettings(mainDelayMs: number) {
  settingsCollection.insert({
    id: "app-settings",
    player: { mode: "single", restoreStateOnLoad: true },
    audio: {
      mainOutputId: "default",
      cueOutputId: null,
      delay: { mainDelayMs, cueDelayMs: 0 },
    },
  });
}

function insertSingleSession(volume = 0.42) {
  playbackSessionsCollection.insert({
    id: "single",
    channels: [
      {
        ...createDefaultChannel(SINGLE_ACTIVE_CHANNEL_ID, "single-primary", 0),
        radio: {
          id: "station-1",
          name: "Station 1",
          streamUrl: "https://radio.example/station.mp3",
        },
        volume,
      },
    ],
    masterVolume: 0.75,
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    activeChannelId: SINGLE_ACTIVE_CHANNEL_ID,
  });
}

function createTestContext(outputMode: "audio-graph" | "native") {
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
  const context = {
    audio: {
      pauseSound: mock((_soundId: string) => undefined),
      playSound: mock(async (_soundId: string, _volume: number) => undefined),
      setGlobalVolume: mock((_volume: number) => undefined),
      setMainDelay: mock((_delayMs: number) => undefined),
    } as unknown as AudioManager,
    audioEngine,
    channels: {
      activate: mock(
        (
          _sessionId,
          _channelId,
          _radio,
          optionsOrSoundId?: string | { soundId?: string }
        ) =>
          typeof optionsOrSoundId === "string"
            ? optionsOrSoundId
            : (optionsOrSoundId?.soundId ?? "single:active")
      ),
      deactivateAll: mock(() => undefined),
      deactivate: mock((_channelId: string) => undefined),
      getOutputMode: mock((_channelId: string) => outputMode),
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
  return context;
}

beforeEach(async () => {
  await resetCollections();
  resetAllPlaybackRuntime();
  setAudioConstructor(
    class {
      volume = 1;
    }
  );
});

afterEach(async () => {
  await resetCollections();
  resetAllPlaybackRuntime();
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: originalAudio,
    writable: true,
  });
});

describe("Single playback routing updates", () => {
  test("moves a playing native sound into the audio graph when delay is enabled", async () => {
    insertAudioSettings(0);
    insertSingleSession();
    const nativeRuntime = { soundId: "single:single-a", isPlaying: true };
    setPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID, () => nativeRuntime);
    setMainDelayMs(120);
    const context = createTestContext("native");
    const workflow = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });

    await workflow.reconcileRouting();

    expect(context.channels.deactivate).toHaveBeenCalledWith(
      SINGLE_ACTIVE_CHANNEL_ID
    );
    expect(context.channels.activate).toHaveBeenCalledWith(
      "single",
      SINGLE_ACTIVE_CHANNEL_ID,
      expect.objectContaining({ id: "station-1" }),
      "single:single-a"
    );
    expect(context.resumeAudioContext).toHaveBeenCalledTimes(1);
    expect(context.audio.playSound).toHaveBeenCalledWith(
      "single:single-a",
      0.42
    );
  });

  test("moves a paused graph sound to native playback without starting it", async () => {
    insertAudioSettings(0);
    insertSingleSession();
    const graphRuntime = { soundId: "single:single-a", isPlaying: false };
    setPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID, () => graphRuntime);
    const context = createTestContext("audio-graph");
    const workflow = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });

    await workflow.reconcileRouting();

    expect(context.channels.deactivate).toHaveBeenCalledWith(
      SINGLE_ACTIVE_CHANNEL_ID
    );
    expect(context.channels.activate).toHaveBeenCalledWith(
      "single",
      SINGLE_ACTIVE_CHANNEL_ID,
      expect.objectContaining({ id: "station-1" }),
      "single:single-a"
    );
    expect(context.audio.playSound).not.toHaveBeenCalled();
    expect(context.resumeAudioContext).not.toHaveBeenCalled();
  });

  test("moves native playback into the audio graph when media volume is read-only", async () => {
    setAudioConstructor(
      class {
        get volume() {
          return 1;
        }

        set volume(_volume: number) {
          // iOS ignores programmatic media volume changes.
        }
      }
    );
    insertAudioSettings(0);
    insertSingleSession();
    const nativeRuntime = { soundId: "single:single-a", isPlaying: true };
    setPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID, () => nativeRuntime);
    const context = createTestContext("native");
    const workflow = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });

    await workflow.reconcileRouting();

    expect(context.channels.deactivate).toHaveBeenCalledWith(
      SINGLE_ACTIVE_CHANNEL_ID
    );
    expect(context.resumeAudioContext).toHaveBeenCalledTimes(1);
    expect(context.audio.playSound).toHaveBeenCalledWith(
      "single:single-a",
      0.42
    );
  });

  test("waits for an in-flight station selection before reconciling its route", async () => {
    insertAudioSettings(0);
    insertSingleSession();
    setPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID, () => ({
      soundId: "single:single-a",
      isPlaying: true,
    }));
    let releasePlayback: (() => void) | undefined;
    const playbackStarted = new Promise<void>((resolve) => {
      releasePlayback = resolve;
    });
    const context = createTestContext("native");
    context.audio.playSound = mock(async () => playbackStarted);
    const workflow = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });
    const replacement = {
      id: "station-2",
      name: "Station 2",
      streamUrl: "https://radio.example/station-2.mp3",
    };

    const selection = workflow.selectRadio(replacement);
    await Promise.resolve();
    setMainDelayMs(120);
    const routing = workflow.reconcileRouting();
    releasePlayback?.();
    await Promise.all([selection, routing]);

    expect(getPlaybackSession("single")?.channels[0]?.radio).toEqual(
      replacement
    );
  });

  test("skips queued routing when deactivation supersedes selection", async () => {
    insertAudioSettings(0);
    insertSingleSession();
    setPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID, () => ({
      soundId: "single:single-a",
      isPlaying: true,
    }));
    let releasePlayback: (() => void) | undefined;
    const playbackStarted = new Promise<void>((resolve) => {
      releasePlayback = resolve;
    });
    const context = createTestContext("native");
    context.audio.playSound = mock(async () => playbackStarted);
    const workflow = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });

    const selection = workflow.selectRadio({
      id: "station-2",
      name: "Station 2",
      streamUrl: "https://radio.example/station-2.mp3",
    });
    await Promise.resolve();
    setMainDelayMs(120);
    const routing = workflow.reconcileRouting();
    const deactivation = workflow.deactivate();
    releasePlayback?.();
    await Promise.all([selection, routing, deactivation]);

    expect(context.channels.activate).toHaveBeenCalledTimes(1);
  });
});
