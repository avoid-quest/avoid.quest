import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioEngineFacade, AudioManager, Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  getPlaybackChannel,
  playbackSessionsCollection,
  SINGLE_ACTIVE_CHANNEL_ID,
  SINGLE_STANDBY_CHANNEL_ID,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";
import { setMainDelayMs, settingsCollection } from "@/lib/collections/settings";
import {
  getPlaybackChannelRuntime,
  resetAllPlaybackRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import type { PlaybackActionContext } from "./playback-action-context";
import {
  getSinglePlayback,
  type SingleSelectionFailure,
} from "./single-playback";

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

  test("rolls back to the previous Station and reports the failed switch", async () => {
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

    const onSwitchFailed = mock(
      (_failure: SingleSelectionFailure) => undefined
    );

    await getSinglePlayback({ ctx: context }).selectStation(replacement, {
      onSwitchFailed,
    });

    expect(onSwitchFailed).toHaveBeenCalledWith({
      message:
        "Playback could not start. Check the station stream and try again.",
      station: replacement,
    });
    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(current);
    expect(context.audio.playSound).toHaveBeenCalledTimes(2);
    expect(
      getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).error
    ).toBeNull();
    expect(context.reportError).toHaveBeenCalledTimes(1);
  });

  test("reports sound creation failures for an initially paused selection as a failed switch", async () => {
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

    const onSwitchFailed = mock(
      (_failure: SingleSelectionFailure) => undefined
    );

    await getSinglePlayback({ ctx: context }).selectStation(replacement, {
      onSwitchFailed,
    });

    expect(onSwitchFailed).toHaveBeenCalledWith(
      expect.objectContaining({ station: replacement })
    );
    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(current);
    expect(
      getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).error
    ).toBeNull();
    expect(context.reportError).toHaveBeenCalledTimes(1);
  });

  test("reports replacement errors inline when nothing can resume", async () => {
    const current = station("current");
    const replacement = station("replacement");
    insertSingleSession(current, true, SINGLE_STANDBY_CHANNEL_ID);
    setPlaybackChannelRuntime(SINGLE_STANDBY_CHANNEL_ID, () => ({
      soundId: null,
    }));
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

    const onSwitchFailed = mock(
      (_failure: SingleSelectionFailure) => undefined
    );

    const selection = playback.selectStation(station("replacement"), {
      onSwitchFailed,
    });
    await Promise.resolve();
    await playback.setPlaying(false);
    pendingPlay.reject(new Error("replacement failed"));
    await selection;

    expect(onSwitchFailed).not.toHaveBeenCalled();
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

  test("pausing a connecting Station settles its loading state", async () => {
    insertSingleSession(station("current"));
    setPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID, () => ({
      isLoading: true,
      isPlaying: true,
    }));
    const context = createTestContext();
    context.audio.pauseSound = mock((_soundId: string) => undefined);

    await getSinglePlayback({ ctx: context }).setPlaying(false);

    expect(context.audio.pauseSound).toHaveBeenCalledWith("single:single-a");
    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID)).toMatchObject({
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
    });
  });

  test("switching back to the previous Station while another connects resumes it", async () => {
    const current = station("current");
    insertSingleSession(current, true);
    const pendingNext = createDeferred();
    let attempt = 0;
    const context = createTestContext();
    context.audio.playSound = mock(() => {
      attempt += 1;
      if (attempt === 1) {
        return pendingNext.promise;
      }
      setPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID, () => ({
        isPlaying: true,
      }));
      return Promise.resolve();
    });
    const playback = getSinglePlayback({ ctx: context });

    const switching = playback.selectStation(station("next"));
    await Promise.resolve();
    await playback.selectStation(current);
    await switching;

    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(current);
    expect(context.audio.playSound).toHaveBeenCalledTimes(2);
    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID)).toMatchObject({
      error: null,
      isPlaying: true,
      soundId: "single:single-a",
    });
  });

  test("a play request selects and starts a Station while paused", async () => {
    insertSingleSession(station("current"));
    const context = createTestContext();

    await getSinglePlayback({ ctx: context }).selectStation(station("next"), {
      play: true,
    });

    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(station("next"));
    expect(context.audio.playSound).toHaveBeenCalledTimes(1);
    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).isPlaying).toBe(
      true
    );
  });

  test("a play request starts the already selected Station once", async () => {
    const current = station("current");
    insertSingleSession(current);
    const context = createTestContext();
    const playback = getSinglePlayback({ ctx: context });

    await playback.selectStation(current, { play: true });
    await playback.selectStation(current, { play: true });

    expect(context.audio.playSound).toHaveBeenCalledTimes(1);
  });

  test("mute is a persisted Channel flag that keeps the Channel volume", () => {
    insertSingleSession(station("current"), true);
    const context = createTestContext();
    context.channels.setMuted = mock((sessionId, channelId, muted) => {
      updatePlaybackChannel(sessionId, channelId, (draft) => {
        draft.muted = muted;
      });
    });
    context.channels.setVolume = mock((sessionId, channelId, volume) => {
      updatePlaybackChannel(sessionId, channelId, (draft) => {
        draft.volume = volume;
      });
    });
    const playback = getSinglePlayback({ ctx: context });

    playback.toggleMute();
    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)
    ).toMatchObject({ muted: true, volume: 0.42 });

    playback.toggleMute();
    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)
    ).toMatchObject({ muted: false, volume: 0.42 });
    // Unmuting re-applies the persisted volume, not the audio engine's default.
    expect(context.channels.setVolume).toHaveBeenLastCalledWith(
      "single",
      SINGLE_ACTIVE_CHANNEL_ID,
      0.42
    );
  });

  test("raising the volume unmutes the Single Channel", () => {
    insertSingleSession(station("current"));
    updatePlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID, (draft) => {
      draft.muted = true;
    });
    const context = createTestContext();

    getSinglePlayback({ ctx: context }).setVolume(0.6);

    expect(context.channels.setMuted).toHaveBeenCalledWith(
      "single",
      SINGLE_ACTIVE_CHANNEL_ID,
      false
    );
    expect(context.channels.setVolume).toHaveBeenCalledWith(
      "single",
      SINGLE_ACTIVE_CHANNEL_ID,
      0.6
    );
  });

  test("a muted Channel starts silent and a new Station keeps the mute", async () => {
    insertSingleSession(station("current"));
    updatePlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID, (draft) => {
      draft.muted = true;
    });
    const context = createTestContext();
    const playback = getSinglePlayback({ ctx: context });

    await playback.setPlaying(true);
    await playback.selectStation(station("next"));

    expect(context.audio.playSound).toHaveBeenNthCalledWith(
      1,
      "single:single-a",
      0
    );
    expect(context.audio.playSound).toHaveBeenNthCalledWith(
      2,
      "single:single-a",
      0
    );
    expect(context.channels.setMuted).toHaveBeenCalledWith(
      "single",
      SINGLE_ACTIVE_CHANNEL_ID,
      true
    );
  });

  test("rebinds a saved copy of the current Station without restarting it", () => {
    const discovered = { ...station("rb_live"), id: "rb_live" };
    insertSingleSession(discovered, true);
    const saved = { ...discovered, id: "saved-1" };
    const context = createTestContext();

    getSinglePlayback({ ctx: context }).rebindStation(saved);

    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(saved);
    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID)).toMatchObject({
      isPlaying: true,
      soundId: "single:single-a",
    });
    expect(context.channels.deactivate).not.toHaveBeenCalled();
    expect(context.audio.playSound).not.toHaveBeenCalled();
  });

  test("releasing a deleted current Station stops it and clears the selection", async () => {
    const current = station("current");
    insertSingleSession(current, true);
    const context = createTestContext();

    await getSinglePlayback({ ctx: context }).releaseStation(current);

    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toBeNull();
    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID)).toMatchObject({
      isPlaying: false,
      soundId: null,
    });
  });

  test("releasing leaves a different current Station alone", async () => {
    const current = station("current");
    insertSingleSession(current, true);
    const context = createTestContext();

    await getSinglePlayback({ ctx: context }).releaseStation(station("other"));

    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(current);
    expect(context.channels.deactivate).not.toHaveBeenCalled();
  });
});
