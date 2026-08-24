import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioEngineFacade, AudioManager, Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  getPlaybackChannel,
  playbackSessionsCollection,
  SINGLE_ACTIVE_CHANNEL_ID,
  SINGLE_STANDBY_CHANNEL_ID,
} from "@/lib/collections/playback-sessions";
import { setMainDelayMs, settingsCollection } from "@/lib/collections/settings";
import {
  getPlaybackChannelRuntime,
  resetAllPlaybackRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import type { PlaybackActionContext } from "./playback-action-context";
import { getSinglePlayback } from "./single-playback";

function station(id: string): Radio {
  return {
    id,
    name: `Station ${id}`,
    streamUrl: `https://radio.example/${id}.mp3`,
  };
}

function createDeferred<T = void>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let reject = (_reason?: unknown): void => undefined;
  let resolve = (_value: T | PromiseLike<T>): void => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    reject = promiseReject;
    resolve = promiseResolve;
  });
  return { promise, reject, resolve };
}

async function resetPlaybackSessions(): Promise<void> {
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

function insertSettings(): void {
  settingsCollection.insert({
    id: "app-settings",
    player: { mode: "single", restoreStateOnLoad: true },
    audio: {
      mainOutputId: "default",
      cueOutputId: null,
      delay: { mainDelayMs: 0, cueDelayMs: 0 },
    },
  });
}

function insertSingleSession(radio: Radio, playing = false): void {
  playbackSessionsCollection.insert({
    id: "single",
    channels: [
      {
        ...createDefaultChannel(SINGLE_ACTIVE_CHANNEL_ID, "single-primary", 0),
        radio,
        volume: 0.42,
      },
      createDefaultChannel(SINGLE_STANDBY_CHANNEL_ID, "single-secondary", 1),
    ],
    masterVolume: 0.75,
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    activeChannelId: SINGLE_ACTIVE_CHANNEL_ID,
  });
  setPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID, () => ({
    soundId: "single:single-a",
    isPlaying: playing,
  }));
}

function createTestContext(): PlaybackActionContext {
  return {
    audio: {
      hasSound: mock((_soundId: string) => false),
      cleanupSound: mock((_soundId: string) => undefined),
      pauseSound: mock((_soundId: string) => {
        setPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID, () => ({
          isPlaying: false,
        }));
      }),
      playSound: mock((_soundId: string, _volume: number) => {
        setPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID, () => ({
          isPlaying: true,
        }));
        return Promise.resolve();
      }),
      setGlobalVolume: mock((_volume: number) => undefined),
      setMainDelay: mock((_delayMs: number) => undefined),
    } as unknown as AudioManager,
    audioEngine: {
      playback: {
        pause: mock((_soundId: string) => undefined),
        play: mock(async (_soundId: string, _volume?: number) => undefined),
        refreshStreamUrl: mock(
          async (_soundId: string, _newUrl: string, _seek?: number) => undefined
        ),
        seek: mock((_soundId: string, _position: number) => undefined),
      },
      volume: {
        setChannelVolume: mock(
          (_soundId: string, _volume: number) => undefined
        ),
        setMasterVolume: mock((_volume: number) => undefined),
      },
    } satisfies AudioEngineFacade,
    channels: {
      activate: mock(
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
      ),
      deactivate: mock((channelId: string) => {
        resetPlaybackChannelRuntime(channelId);
      }),
      deactivateAll: mock(() => undefined),
      getOutputMode: mock((_channelId: string) => "audio-graph" as const),
      setMuted: mock((_sessionId, _channelId, _muted) => undefined),
      setPan: mock((_sessionId, _channelId, _pan) => undefined),
      setSpeed: mock((_sessionId, _channelId, _speed) => undefined),
      setVolume: mock((_sessionId, _channelId, _volume) => undefined),
      subscribeRuntime: mock((_sessionId, _channelId, _soundId) => undefined),
    },
    getMainOutputRouter: () => null,
    lifecycle: { mainOutputSettingsApplied: true },
    reportError: mock(() => undefined),
    resumeAudioContext: mock(async () => undefined),
    resetAudioManager: mock(() => undefined),
  };
}

beforeEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
  insertSettings();
});

afterEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
});

describe("Single Playback", () => {
  test("selects a Station through one context-owned interface", async () => {
    insertSingleSession(station("current"));
    const context = createTestContext();
    const playback = getSinglePlayback({ ctx: context });

    expect(getSinglePlayback({ ctx: context })).toBe(playback);

    await playback.selectStation(station("next"));

    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(station("next"));
    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).soundId).toBe(
      "single:single-a"
    );
  });

  test("owns rollback and the safe error when replacement playback fails", async () => {
    const current = station("current");
    const replacement = station("replacement");
    insertSingleSession(current, true);
    let attempt = 0;
    const context = createTestContext();
    context.audio.playSound = mock(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error("raw browser playback detail"))
        : Promise.resolve();
    });

    await getSinglePlayback({ ctx: context }).selectStation(replacement);

    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(current);
    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID)).toMatchObject({
      isPlaying: false,
      error: {
        code: "PLAY_ERROR",
        message:
          "Playback could not start. Check the station stream and try again.",
      },
    });
    expect(context.reportError).toHaveBeenCalledTimes(1);
  });

  test("keeps only the latest overlapping selection intent", async () => {
    insertSingleSession(station("current"), true);
    const stalledPlay = createDeferred();
    let attempt = 0;
    const context = createTestContext();
    context.audio.playSound = mock(() => {
      attempt += 1;
      return attempt === 1 ? stalledPlay.promise : Promise.resolve();
    });
    const playback = getSinglePlayback({ ctx: context });

    const first = playback.selectStation(station("first"));
    await Promise.resolve();
    const second = playback.selectStation(station("second"));
    await Promise.all([first, second]);
    stalledPlay.reject(new Error("stale failure"));
    await Promise.resolve();

    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(station("second"));
    expect(
      getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).error
    ).toBeNull();
  });

  test("pausing a pending selection keeps rollback paused", async () => {
    const current = station("current");
    insertSingleSession(current, true);
    const pendingPlay = createDeferred();
    const context = createTestContext();
    context.audio.playSound = mock(() => pendingPlay.promise);
    const playback = getSinglePlayback({ ctx: context });

    const selection = playback.selectStation(station("replacement"));
    await Promise.resolve();
    await playback.setPlaying(false);
    pendingPlay.reject(new Error("replacement failed"));
    await selection;

    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(current);
    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).isPlaying).toBe(
      false
    );
  });

  test("deactivation supersedes an in-flight selection", async () => {
    const current = station("current");
    insertSingleSession(current, true);
    const pendingPlay = createDeferred();
    const context = createTestContext();
    context.audio.playSound = mock(() => pendingPlay.promise);
    const playback = getSinglePlayback({ ctx: context });

    const selection = playback.selectStation(station("replacement"));
    await Promise.resolve();
    await Promise.all([selection, playback.deactivate()]);

    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(current);
    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID)).toMatchObject({
      soundId: null,
      isPlaying: false,
      error: null,
    });
  });

  test("deactivation owns orphan cleanup and runtime reset", async () => {
    playbackSessionsCollection.insert({
      id: "single",
      channels: [
        {
          ...createDefaultChannel(
            SINGLE_ACTIVE_CHANNEL_ID,
            "single-primary",
            0
          ),
          radio: station("current"),
        },
      ],
      masterVolume: 1,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: SINGLE_ACTIVE_CHANNEL_ID,
    });
    setPlaybackChannelRuntime(SINGLE_STANDBY_CHANNEL_ID, () => ({
      soundId: "single:orphan",
      isPlaying: true,
      error: {
        id: "stale",
        code: "STREAM_ABORTED",
        message: "stale",
        timestamp: 1,
      },
    }));
    const liveSounds = new Set(["single:orphan"]);
    const context = createTestContext();
    context.audio.hasSound = mock((soundId: string) => liveSounds.has(soundId));
    context.audio.cleanupSound = mock((soundId: string) => {
      liveSounds.delete(soundId);
    });
    const fadeOutSound = mock(
      async (_soundId: string, _durationMs: number, _stopAfter: boolean) =>
        undefined
    );
    const playback = getSinglePlayback({ ctx: context, fadeOutSound });

    await playback.deactivate();

    expect(liveSounds.size).toBe(0);
    expect(getPlaybackChannelRuntime(SINGLE_STANDBY_CHANNEL_ID)).toMatchObject({
      soundId: null,
      isPlaying: false,
      error: null,
    });
  });

  test("reconciles a playing Station route without changing its runtime intent", async () => {
    insertSingleSession(station("current"), true);
    setMainDelayMs(120);
    const context = createTestContext();
    context.channels.getOutputMode = mock(
      (_channelId: string) => "native" as const
    );

    await getSinglePlayback({ ctx: context }).reconcileRouting();

    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID)).toMatchObject({
      soundId: "single:single-a",
      isPlaying: true,
      error: null,
    });
    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(station("current"));
  });

  test("activation resets a non-restorable active Station", async () => {
    const localFile = {
      ...station("local"),
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
    } as Radio;
    insertSingleSession(localFile, true);

    await getSinglePlayback({ ctx: createTestContext() }).activate();

    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID)).toMatchObject({
      soundId: null,
      isPlaying: false,
      error: null,
    });
  });
});
