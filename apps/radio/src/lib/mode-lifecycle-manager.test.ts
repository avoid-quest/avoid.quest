import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioEngineFacade, AudioManager } from "@/lib/audio";
import {
  createDefaultChannel,
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  type PlaybackSessionId,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import {
  getPlaybackChannelRuntime,
  resetAllPlaybackRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import {
  createModeLifecycleRegistry,
  createModeManager,
  synchronizePlaybackMode,
} from "./mode-lifecycle-manager";
import type { PlaybackActionContext } from "./playback-action-context";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
}

function insertPlaybackSession(id: PlaybackSessionId) {
  playbackSessionsCollection.insert({
    id,
    channels: [],
    masterVolume: 1,
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    activeChannelId: null,
  });
}

type ChannelActivationSoundIdOption = string | { soundId?: string };

function getActivatedSoundId(
  channelId: string,
  optionsOrSoundId?: ChannelActivationSoundIdOption
): string {
  if (typeof optionsOrSoundId === "string") {
    return optionsOrSoundId;
  }
  return optionsOrSoundId?.soundId ?? `sound:${channelId}`;
}

function createModeLifecycleTestContext() {
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
  resetAllPlaybackRuntime();
});

afterEach(async () => {
  await resetPlaybackSessions();
  resetAllPlaybackRuntime();
});

describe("mode lifecycle manager", () => {
  test("routes startup mode activation through the lifecycle boundary", async () => {
    insertPlaybackSession("multiple");
    const activateInitialMode = mock(async (_mode: string) => undefined);
    const switchTo = mock(async (_mode: string) => undefined);
    const manager = {
      getSnapshot: () => ({
        currentMode: null,
        requestedMode: null,
        phase: "inactive" as const,
        error: null,
      }),
      subscribe: mock((_listener: () => void) => () => undefined),
      activateInitialMode,
      switchTo,
    };

    await synchronizePlaybackMode("multiple", manager);

    expect(activateInitialMode).toHaveBeenCalledWith("multiple");
    expect(switchTo).not.toHaveBeenCalled();
  });

  test("waits for startup playback session readiness before activating mode", async () => {
    const activateInitialMode = mock(async (_mode: string) => undefined);
    const switchTo = mock(async (_mode: string) => undefined);
    const getSnapshot = mock(() => ({
      currentMode: null,
      requestedMode: null,
      phase: "inactive" as const,
      error: null,
    }));
    const manager = {
      getSnapshot,
      subscribe: mock((_listener: () => void) => () => undefined),
      activateInitialMode,
      switchTo,
    };

    const activation = synchronizePlaybackMode("multiple", manager);
    await Promise.resolve();
    await Promise.resolve();

    expect(getSnapshot).not.toHaveBeenCalled();
    expect(activateInitialMode).not.toHaveBeenCalled();

    insertPlaybackSession("multiple");
    await activation;

    expect(activateInitialMode).toHaveBeenCalledWith("multiple");
    expect(switchTo).not.toHaveBeenCalled();
  });

  test("serializes concurrent mode switch requests through the lifecycle boundary", async () => {
    const releaseActivation = Promise.withResolvers<void>();
    const committedModes: string[] = [];
    const manager = createModeManager({
      initialMode: "single",
      lifecycles: {
        single: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        multiple: {
          activate: mock(async () => {
            await releaseActivation.promise;
          }),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        dj: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
      commitMode: mock((mode) => {
        committedModes.push(mode);
      }),
    });

    const firstSwitch = manager.switchTo("multiple");
    const queuedSwitch = manager.switchTo("dj");

    await Promise.resolve();
    await Promise.resolve();
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      requestedMode: "multiple",
      phase: "activating",
    });
    expect(committedModes).toEqual([]);

    releaseActivation.resolve();
    await firstSwitch;
    await queuedSwitch;

    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "dj",
      phase: "active",
    });
    expect(committedModes).toEqual(["multiple", "dj"]);
  });

  test("rolls back to the previous active mode when activation fails", async () => {
    const commitMode = mock((_mode: string) => undefined);
    const singleActivate = mock(async () => undefined);
    const manager = createModeManager({
      initialMode: "single",
      lifecycles: {
        single: {
          activate: singleActivate,
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        multiple: {
          activate: mock(() => Promise.reject(new Error("activation failed"))),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        dj: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
      commitMode,
    });

    await expect(manager.switchTo("multiple")).rejects.toThrow(
      "activation failed"
    );

    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      phase: "active",
    });
    expect(singleActivate).toHaveBeenCalledTimes(1);
    expect(commitMode).not.toHaveBeenCalled();
  });

  test("deactivates the newly activated mode before rolling back when commit fails", async () => {
    const singleActivate = mock(async () => undefined);
    const multipleDeactivate = mock(async () => undefined);
    const commitMode = mock(() => {
      throw new Error("settings commit failed");
    });
    const manager = createModeManager({
      initialMode: "single",
      lifecycles: {
        single: {
          activate: singleActivate,
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        multiple: {
          activate: mock(async () => undefined),
          deactivate: multipleDeactivate,
          getPhase: () => "inactive",
        },
        dj: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
      commitMode,
    });

    await expect(manager.switchTo("multiple")).rejects.toThrow(
      "settings commit failed"
    );

    expect(multipleDeactivate).toHaveBeenCalledTimes(1);
    expect(singleActivate).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      phase: "active",
      error: "Mode could not be changed. Try again.",
    });
  });

  test("surfaces safe mode transition errors without leaking implementation details", async () => {
    const manager = createModeManager({
      initialMode: "single",
      lifecycles: {
        single: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        multiple: {
          activate: mock(() =>
            Promise.reject(
              new Error(
                "Failed to execute 'linearRampToValueAtTime' on 'AudioParam'"
              )
            )
          ),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        dj: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
      commitMode: mock(() => undefined),
    });

    await expect(manager.switchTo("multiple")).rejects.toThrow(
      "linearRampToValueAtTime"
    );

    expect(manager.getSnapshot().error).toBe(
      "Mode could not be changed. Try again."
    );
  });

  test("switching out of DJ mode cleans up deck audio through lifecycle boundaries", async () => {
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
    insertPlaybackSession("single");
    setPlaybackChannelRuntime(DECK_A_CHANNEL_ID, () => ({
      soundId: "left_station-1",
      isPlaying: true,
    }));
    setPlaybackChannelRuntime(DECK_B_CHANNEL_ID, () => ({
      soundId: "right_station-2",
      isPlaying: true,
    }));
    const context = createModeLifecycleTestContext();
    const fadeOut = mock((_soundId: string, _durationMs: number) =>
      Promise.resolve()
    );
    const manager = createModeManager({
      initialMode: "dj",
      lifecycles: createModeLifecycleRegistry({
        ctx: context,
        fadeOutDurationMs: 120,
        fadeOutSound: fadeOut,
      }),
      commitMode: mock(() => undefined),
    });

    await manager.switchTo("single");

    expect(fadeOut).toHaveBeenCalledWith("left_station-1", 120, true);
    expect(fadeOut).toHaveBeenCalledWith("right_station-2", 120, true);
    expect(context.channels.deactivate).toHaveBeenCalledWith(DECK_A_CHANNEL_ID);
    expect(context.channels.deactivate).toHaveBeenCalledWith(DECK_B_CHANNEL_ID);
    expect(getPlaybackChannelRuntime(DECK_A_CHANNEL_ID).soundId).toBeNull();
    expect(getPlaybackChannelRuntime(DECK_B_CHANNEL_ID).soundId).toBeNull();
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      phase: "active",
    });
  });

  test("keeps failed initial activation retryable without committing mode state", async () => {
    let shouldFailActivation = true;
    const activateSingle = mock(() => {
      if (shouldFailActivation) {
        shouldFailActivation = false;
        return Promise.reject(new Error("session is not ready"));
      }
      return Promise.resolve();
    });
    const commitMode = mock((_mode: string) => undefined);
    const manager = createModeManager({
      lifecycles: {
        single: {
          activate: activateSingle,
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        multiple: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        dj: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
      commitMode,
    });

    await expect(manager.activateInitialMode("single")).rejects.toThrow(
      "session is not ready"
    );

    expect(manager.getSnapshot()).toMatchObject({
      currentMode: null,
      phase: "inactive",
      error: "Playback mode could not start. Try again.",
    });
    expect(commitMode).not.toHaveBeenCalled();

    await manager.activateInitialMode("single");

    expect(activateSingle).toHaveBeenCalledTimes(2);
    expect(commitMode).not.toHaveBeenCalled();
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      phase: "active",
      error: null,
    });
  });
});
