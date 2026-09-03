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
    audio: {
      cueOutputId: null,
      delay: { cueDelayMs: 0, mainDelayMs: 0 },
      mainOutputId: "default",
    },
    id: "app-settings",
    player: { mode: "single", restoreStateOnLoad: true },
  });
}

function insertSingleSession(
  radio: Radio,
  playing = false,
  activeChannelId = SINGLE_ACTIVE_CHANNEL_ID
): void {
  playbackSessionsCollection.insert({
    activeChannelId,
    channels: [
      {
        ...createDefaultChannel(SINGLE_ACTIVE_CHANNEL_ID, "single-primary", 0),
        radio: activeChannelId === SINGLE_ACTIVE_CHANNEL_ID ? radio : null,
        volume: 0.42,
      },
      {
        ...createDefaultChannel(
          SINGLE_STANDBY_CHANNEL_ID,
          "single-secondary",
          1
        ),
        radio: activeChannelId === SINGLE_STANDBY_CHANNEL_ID ? radio : null,
        volume: 0.42,
      },
    ],
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    id: "single",
    masterVolume: 0.75,
  });
  setPlaybackChannelRuntime(activeChannelId, () => ({
    isPlaying: playing,
    soundId: `single:${activeChannelId}`,
  }));
}

function createTestContext(): PlaybackActionContext {
  return {
    audio: {
      cleanupSound: mock((_soundId: string) => undefined),
      hasSound: mock((_soundId: string) => false),
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
    resetAudioManager: mock(() => undefined),
    resumeAudioContext: mock(async () => undefined),
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
      error: {
        code: "PLAY_ERROR",
        message:
          "Playback could not start. Check the station stream and try again.",
      },
      isPlaying: false,
    });
    expect(context.reportError).toHaveBeenCalledTimes(1);
  });

  test("reports sound creation failures for an initially paused selection", async () => {
    const current = station("current");
    const replacement = station("replacement");
    insertSingleSession(current);
    const context = createTestContext();
    context.channels.activate = mock(
      (_sessionId, channelId, radio, optionsOrSoundId) => {
        if (radio.id === replacement.id) {
          throw new Error("sound creation failed");
        }
        const soundId =
          typeof optionsOrSoundId === "string"
            ? optionsOrSoundId
            : (optionsOrSoundId?.soundId ?? `sound:${channelId}`);
        setPlaybackChannelRuntime(channelId, () => ({ soundId }));
        return soundId;
      }
    );

    await getSinglePlayback({ ctx: context }).selectStation(replacement);

    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(current);
    expect(
      getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).error
    ).toMatchObject({ code: "PLAY_ERROR" });
    expect(context.reportError).toHaveBeenCalledTimes(1);
  });

  test("reports replacement errors on the active Single Channel", async () => {
    const current = station("current");
    const replacement = station("replacement");
    insertSingleSession(current, true, SINGLE_STANDBY_CHANNEL_ID);
    const context = createTestContext();
    context.audio.playSound = mock(() =>
      Promise.reject(new Error("replacement failed"))
    );

    await getSinglePlayback({ ctx: context }).selectStation(replacement);

    expect(
      getPlaybackChannelRuntime(SINGLE_STANDBY_CHANNEL_ID).error
    ).toMatchObject({ code: "PLAY_ERROR" });
    expect(
      getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).error
    ).toBeNull();
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
    expect(context.reportError).not.toHaveBeenCalled();
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
    expect(
      getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).error
    ).toBeNull();
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("ignores a rejected direct start after manual pause", async () => {
    insertSingleSession(station("current"));
    const pendingPlay = createDeferred();
    const context = createTestContext();
    context.audio.playSound = mock(() => pendingPlay.promise);
    const playback = getSinglePlayback({ ctx: context });

    const starting = playback.setPlaying(true);
    await Promise.resolve();
    await playback.setPlaying(false);
    pendingPlay.reject(new Error("stale start failure"));
    await starting;

    expect(
      getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).error
    ).toBeNull();
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("reports direct start errors on the active Single Channel", async () => {
    insertSingleSession(station("current"), false, SINGLE_STANDBY_CHANNEL_ID);
    const context = createTestContext();
    context.audio.playSound = mock(() =>
      Promise.reject(new Error("start failed"))
    );

    await getSinglePlayback({ ctx: context }).setPlaying(true);

    expect(
      getPlaybackChannelRuntime(SINGLE_STANDBY_CHANNEL_ID).error
    ).toMatchObject({ code: "PLAY_ERROR" });
    expect(
      getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).error
    ).toBeNull();
  });

  test("ignores a rejected direct start after a newer start wins", async () => {
    insertSingleSession(station("current"));
    const stalePlay = createDeferred();
    let attempt = 0;
    const context = createTestContext();
    context.audio.playSound = mock(() => {
      attempt += 1;
      return attempt === 1 ? stalePlay.promise : Promise.resolve();
    });
    const playback = getSinglePlayback({ ctx: context });

    const staleStart = playback.setPlaying(true);
    await Promise.resolve();
    await playback.setPlaying(true);
    stalePlay.reject(new Error("superseded start failure"));
    await staleStart;

    expect(
      getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).error
    ).toBeNull();
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("ignores a rejected direct start after Station selection wins", async () => {
    const replacement = station("replacement");
    insertSingleSession(station("current"));
    const stalePlay = createDeferred();
    const context = createTestContext();
    context.audio.playSound = mock(() => stalePlay.promise);
    const playback = getSinglePlayback({ ctx: context });

    const staleStart = playback.setPlaying(true);
    await Promise.resolve();
    await playback.selectStation(replacement);
    stalePlay.reject(new Error("superseded start failure"));
    await staleStart;

    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(replacement);
    expect(
      getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).error
    ).toBeNull();
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("keeps a pending start current after a no-op Station selection", async () => {
    const current = station("current");
    insertSingleSession(current);
    const pendingPlay = createDeferred();
    const context = createTestContext();
    context.audio.playSound = mock(() => pendingPlay.promise);
    const playback = getSinglePlayback({ ctx: context });

    const starting = playback.setPlaying(true);
    await Promise.resolve();
    await playback.selectStation(current);
    pendingPlay.reject(new Error("start failed"));
    await starting;

    expect(
      getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).error
    ).toMatchObject({ code: "PLAY_ERROR" });
    expect(context.reportError).toHaveBeenCalledTimes(1);
  });

  test("ignores a rejected direct start after deactivation", async () => {
    insertSingleSession(station("current"));
    const pendingPlay = createDeferred();
    const context = createTestContext();
    context.audio.playSound = mock(() => pendingPlay.promise);
    const playback = getSinglePlayback({
      ctx: context,
      fadeOutSound: mock(async () => undefined),
    });

    const starting = playback.setPlaying(true);
    await Promise.resolve();
    await playback.deactivate();
    pendingPlay.reject(new Error("failure after deactivation"));
    await starting;

    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID)).toMatchObject({
      error: null,
      isPlaying: false,
      soundId: null,
    });
    expect(context.reportError).not.toHaveBeenCalled();
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
    pendingPlay.reject(new Error("failure after deactivation"));
    await Promise.resolve();

    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(current);
    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID)).toMatchObject({
      error: null,
      isPlaying: false,
      soundId: null,
    });
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("deactivation owns orphan cleanup and runtime reset", async () => {
    playbackSessionsCollection.insert({
      activeChannelId: SINGLE_ACTIVE_CHANNEL_ID,
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
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "single",
      masterVolume: 1,
    });
    setPlaybackChannelRuntime(SINGLE_STANDBY_CHANNEL_ID, () => ({
      error: {
        code: "STREAM_ABORTED",
        id: "stale",
        message: "stale",
        timestamp: 1,
      },
      isPlaying: true,
      soundId: "single:orphan",
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
      error: null,
      isPlaying: false,
      soundId: null,
    });
  });

  test("deactivation cleans a persisted legacy Single Channel", async () => {
    const channelId = "legacy-single";
    playbackSessionsCollection.insert({
      activeChannelId: channelId,
      channels: [
        {
          ...createDefaultChannel(channelId, "single-primary", 0),
          radio: station("legacy"),
        },
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "single",
      masterVolume: 1,
    });
    setPlaybackChannelRuntime(channelId, () => ({
      isPlaying: true,
      soundId: "single:legacy",
    }));
    const context = createTestContext();
    const fadeOutSound = mock(async () => undefined);

    await getSinglePlayback({ ctx: context, fadeOutSound }).deactivate();

    expect(fadeOutSound).toHaveBeenCalledWith("single:legacy", 150, true);
    expect(context.channels.deactivate).toHaveBeenCalledWith(channelId);
    expect(getPlaybackChannelRuntime(channelId).soundId).toBeNull();
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
      error: null,
      isPlaying: true,
      soundId: "single:single-a",
    });
    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(station("current"));
  });

  test("reports routing errors on the active Single Channel", async () => {
    insertSingleSession(station("current"), true, SINGLE_STANDBY_CHANNEL_ID);
    const context = createTestContext();
    context.channels.getOutputMode = mock(() => "native" as const);
    context.audio.playSound = mock(() =>
      Promise.reject(new Error("route failed"))
    );

    await expect(
      getSinglePlayback({ ctx: context }).reconcileRouting()
    ).rejects.toThrow();

    expect(
      getPlaybackChannelRuntime(SINGLE_STANDBY_CHANNEL_ID).error
    ).toMatchObject({ code: "PLAY_ERROR" });
    expect(
      getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).error
    ).toBeNull();
  });

  test("activation resets a non-restorable active Station", async () => {
    const localFile = {
      ...station("local"),
      platformMetadata: {
        displayName: "Local",
        duration: 10,
        fileName: "local.mp3",
        fileSize: 100,
        itemType: "track",
        mimeType: "audio/mpeg",
        objectUrl: "blob:https://radio.example/local",
        platform: "local-file",
        url: "",
      },
    } as Radio;
    insertSingleSession(localFile, true);

    await getSinglePlayback({ ctx: createTestContext() }).activate();

    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID)).toMatchObject({
      error: null,
      isPlaying: false,
      soundId: null,
    });
  });
});
