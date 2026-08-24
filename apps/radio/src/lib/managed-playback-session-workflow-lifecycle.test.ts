import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  AudioEngineFacade,
  AudioManager,
  AudioState,
  Radio,
} from "@/lib/audio";
import {
  createDefaultChannel,
  getPlaybackChannel,
  playbackSessionsCollection,
  SINGLE_ACTIVE_CHANNEL_ID,
  SINGLE_STANDBY_CHANNEL_ID,
} from "@/lib/collections/playback-sessions";
import {
  getPlaybackChannelRuntime,
  resetAllPlaybackRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { createManagedPlaybackSessionWorkflow } from "./managed-playback-session-workflow";
import type { PlaybackActionContext } from "./playback-action-context";

async function resetPlaybackSessions(): Promise<void> {
  await playbackSessionsCollection.stateWhenReady();
  for (const sessionId of playbackSessionsCollection.state.keys()) {
    playbackSessionsCollection.delete(sessionId);
  }
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

function station(id: string): Radio {
  return {
    id,
    name: `Station ${id}`,
    streamUrl: `https://radio.example/${id}.mp3`,
  };
}

function insertPlayingSingleSession(radio: Radio): void {
  playbackSessionsCollection.insert({
    id: "single",
    channels: [
      {
        ...createDefaultChannel(SINGLE_ACTIVE_CHANNEL_ID, "single-primary", 0),
        radio,
      },
      createDefaultChannel(SINGLE_STANDBY_CHANNEL_ID, "single-secondary", 1),
    ],
    masterVolume: 0.8,
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    activeChannelId: SINGLE_ACTIVE_CHANNEL_ID,
  });
  setPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID, () => ({
    soundId: "single:single-a",
    isPlaying: true,
  }));
}

function createTestContext(): PlaybackActionContext {
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
      pauseSound: mock((_soundId: string) => undefined),
      playSound: mock(async (_soundId: string, _volume: number) => undefined),
      setGlobalVolume: mock((_volume: number) => undefined),
      setMainDelay: mock((_delayMs: number) => undefined),
      setVolume: mock((_soundId: string, _volume: number) => undefined),
      subscribe: mock(
        (_soundId: string, _callback: (state: AudioState) => void) => () =>
          undefined
      ),
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
      activate,
      deactivate: mock((channelId: string) => {
        resetPlaybackChannelRuntime(channelId);
      }),
      deactivateAll: mock(() => undefined),
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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function settlesBeforeDeadline(
  promise: Promise<unknown>,
  deadlineMs = 250
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), deadlineMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

beforeEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
});

afterEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
});

describe("managed playback selection lifecycle", () => {
  test("the latest rapid selection keeps the playing intent", async () => {
    insertPlayingSingleSession(station("active"));
    const context = createTestContext();
    const firstPlay = createDeferred();
    let playCount = 0;
    context.audio.playSound = mock(() => {
      playCount += 1;
      return playCount === 1 ? firstPlay.promise : Promise.resolve();
    });
    const firstFacade = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });
    const secondFacade = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });

    const firstSelection = firstFacade.selectRadio(station("first"));
    await flushMicrotasks();
    const secondSelection = secondFacade.selectRadio(station("second"));

    await Promise.all([firstSelection, secondSelection]);
    firstPlay.reject(new Error("stale stream failure"));
    await flushMicrotasks();

    expect(context.audio.playSound).toHaveBeenCalledTimes(2);
    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(station("second"));
    expect(getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).soundId).toBe(
      "single:single-a"
    );
    expect(context.reportError).not.toHaveBeenCalled();
  });

  test("superseding a paused selection does not start playback", async () => {
    insertPlayingSingleSession(station("active"));
    setPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID, () => ({
      isPlaying: false,
    }));
    const context = createTestContext();
    const firstFacade = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });
    const secondFacade = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });

    const firstSelection = firstFacade.selectRadio(station("first"));
    const secondSelection = secondFacade.selectRadio(station("second"));

    await Promise.all([firstSelection, secondSelection]);

    expect(context.audio.playSound).not.toHaveBeenCalled();
    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(station("second"));
  });

  test("pausing a pending selection clears its inherited playing intent", async () => {
    insertPlayingSingleSession(station("active"));
    const context = createTestContext();
    const firstPlay = createDeferred();
    let playCount = 0;
    context.audio.playSound = mock(() => {
      playCount += 1;
      return playCount === 1 ? firstPlay.promise : Promise.resolve();
    });
    const workflow = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });

    const firstSelection = workflow.selectRadio(station("first"));
    await flushMicrotasks();
    await workflow.setPlaying(false);
    const secondSelection = workflow.selectRadio(station("second"));

    await Promise.all([firstSelection, secondSelection]);

    expect(context.audio.pauseSound).toHaveBeenCalledWith("single:single-a");
    expect(context.audio.playSound).toHaveBeenCalledTimes(1);
    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(station("second"));
  });

  test("deactivation aborts a stalled selection from another facade", async () => {
    const active = station("active");
    insertPlayingSingleSession(active);
    const context = createTestContext();
    const pendingPlay = createDeferred();
    context.audio.playSound = mock(() => pendingPlay.promise);
    const selectionFacade = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });
    const lifecycleFacade = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });

    const selection = selectionFacade.selectRadio(station("next"));
    await flushMicrotasks();
    const deactivation = lifecycleFacade.deactivate();

    expect(
      await settlesBeforeDeadline(Promise.all([selection, deactivation]))
    ).toBe(true);
    expect(
      getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).soundId
    ).toBeNull();
    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(active);
  });

  test("a selection racing deactivation is ignored until cleanup finishes", async () => {
    const active = station("active");
    insertPlayingSingleSession(active);
    const context = createTestContext();
    const fade = createDeferred();
    const lifecycleFacade = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
      fadeOutSound: mock(() => fade.promise),
    });
    const selectionFacade = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });

    const deactivation = lifecycleFacade.deactivate();
    const ignoredSelection = selectionFacade.selectRadio(station("next"));

    expect(await settlesBeforeDeadline(ignoredSelection)).toBe(true);
    expect(
      getPlaybackChannel("single", SINGLE_ACTIVE_CHANNEL_ID)?.radio
    ).toEqual(active);
    expect(context.channels.activate).not.toHaveBeenCalled();

    fade.resolve();
    await deactivation;
    expect(
      getPlaybackChannelRuntime(SINGLE_ACTIVE_CHANNEL_ID).soundId
    ).toBeNull();
  });

  test("Multiple deactivation does not cancel a Single selection", async () => {
    insertPlayingSingleSession(station("active"));
    const context = createTestContext();
    const pendingPlay = createDeferred();
    context.audio.playSound = mock(() => pendingPlay.promise);
    const single = createManagedPlaybackSessionWorkflow("single", {
      ctx: context,
    });
    const multiple = createManagedPlaybackSessionWorkflow("multiple", {
      ctx: context,
    });

    const selection = single.selectRadio(station("next"));
    let selectionSettled = false;
    const trackedSelection = selection.finally(() => {
      selectionSettled = true;
    });
    await flushMicrotasks();
    await multiple.deactivate();
    await flushMicrotasks();

    expect(selectionSettled).toBe(false);
    await single.deactivate();
    await trackedSelection;
    expect(selectionSettled).toBe(true);
  });
});
