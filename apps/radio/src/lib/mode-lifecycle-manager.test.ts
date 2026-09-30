import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioEngineFacade, AudioManager, Radio } from "@/lib/audio";
import {
  createDefaultChannel,
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  type PlaybackSessionId,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import { settingsCollection } from "@/lib/collections/settings";
import { nodeGraphSchema } from "@/lib/node-graph/schema";
import {
  getPlaybackChannelRuntime,
  resetAllPlaybackRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import {
  createModeLifecycleRegistry,
  createModeManager,
  resetPlaybackLifecycleState,
} from "./mode-lifecycle-manager";
import { createModeLifecycleRequests } from "./mode-lifecycle-requests";
import type { PlaybackActionContext } from "./playback-action-context";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
}

async function resetSettings() {
  await settingsCollection.stateWhenReady();

  for (const settingsId of Array.from(settingsCollection.state.keys())) {
    settingsCollection.delete(settingsId);
  }
}

function insertPlaybackSession(id: PlaybackSessionId) {
  playbackSessionsCollection.insert({
    activeChannelId: null,
    channels: [],
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    id,
    masterVolume: 1,
  });
}

/** A node session with one Station wired to Speakers. */
function insertNodeSession() {
  playbackSessionsCollection.insert({
    activeChannelId: null,
    channels: [],
    crossfadePosition: 0.5,
    graph: nodeGraphSchema.parse({
      edges: [
        {
          id: "station-1->speakers",
          source: "station-1",
          sourceHandle: "out:audio:main",
          target: "speakers",
          targetHandle: "in:audio:main",
        },
      ],
      nodes: [
        {
          data: {
            radio: {
              id: "station-1",
              name: "Station 1",
              streamUrl: "https://radio.example/station.mp3",
            },
          },
          id: "station-1",
          position: { x: 0, y: 0 },
          type: "station",
        },
        {
          data: {},
          id: "speakers",
          position: { x: 480, y: 0 },
          type: "speakers",
        },
      ],
      version: 1,
    }),
    headphoneVolume: 1,
    id: "node",
    masterVolume: 1,
  });
}

function insertSettings(mode: PlaybackSessionId) {
  settingsCollection.insert({
    id: "app-settings",
    player: {
      mode,
      restoreStateOnLoad: true,
    },
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
      pause: mock((_soundId: string) => undefined),
      play: mock(async (_soundId: string, _volume?: number) => undefined),
      refreshStreamUrl: mock(
        async (_soundId: string, _newUrl: string, _seekPosition?: number) =>
          undefined
      ),
      seek: mock((_soundId: string, _position: number) => undefined),
    },
    volume: {
      setChannelVolume: mock((_soundId: string, _volume: number) => undefined),
      setMasterVolume: mock((_volume: number) => undefined),
    },
  } satisfies AudioEngineFacade;

  return {
    audio: {
      cleanupSound: mock((_soundId: string) => undefined),
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
      deactivate: mock((_channelId: string) => undefined),
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
    resetAudioManager: mock(() => undefined),
    resumeAudioContext: mock(async () => undefined),
  } satisfies PlaybackActionContext;
}

beforeEach(async () => {
  await resetPlaybackSessions();
  await resetSettings();
  resetAllPlaybackRuntime();
});

afterEach(async () => {
  await resetPlaybackSessions();
  await resetSettings();
  resetAllPlaybackRuntime();
});

describe("mode lifecycle manager", () => {
  const stationRadio = {
    id: "station-1",
    name: "Station 1",
    streamUrl: "https://radio.example/station.mp3",
  } satisfies Radio;

  test("routes startup mode activation through the lifecycle boundary", async () => {
    insertPlaybackSession("multiple");
    const activateInitialMode = mock(async (_mode: string) => undefined);
    const switchTo = mock(async (_mode: string) => undefined);
    const manager = {
      activateInitialMode,
      getSnapshot: () => ({
        currentMode: null,
        error: null,
        phase: "inactive" as const,
        requestedMode: null,
      }),
      subscribe: mock((_listener: () => void) => () => undefined),
      switchTo,
    };

    await createModeLifecycleRequests({ manager }).synchronizeMode("multiple");

    expect(activateInitialMode).toHaveBeenCalledWith("multiple");
    expect(switchTo).not.toHaveBeenCalled();
  });

  test("switching to node activates its lanes and commits the mode", async () => {
    insertPlaybackSession("single");
    insertNodeSession();
    const context = createModeLifecycleTestContext();
    const commitMode = mock((_mode: PlaybackSessionId) => undefined);
    const manager = createModeManager({
      commitMode,
      initialMode: "single",
      lifecycles: createModeLifecycleRegistry({ ctx: context }),
    });

    await manager.switchTo("node");

    expect(context.channels.activate).toHaveBeenCalledWith(
      "node",
      "n:station-1",
      expect.objectContaining({ id: "station-1" }),
      "node:n:station-1"
    );
    expect(context.audio.playSound).not.toHaveBeenCalled();
    expect(commitMode).toHaveBeenCalledWith("node");
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "node",
      phase: "active",
    });
  });

  test("a thrown node activation rolls back to the previous mode", async () => {
    insertPlaybackSession("single");
    insertNodeSession();
    const context = createModeLifecycleTestContext();
    context.channels.activate = mock((_sessionId, channelId) => {
      setPlaybackChannelRuntime(channelId, () => ({
        isLoading: true,
        soundId: "node:n:station-1",
      }));
      throw new Error("node activation failed midway");
    });
    const commitMode = mock((_mode: PlaybackSessionId) => undefined);
    const manager = createModeManager({
      commitMode,
      initialMode: "single",
      lifecycles: createModeLifecycleRegistry({ ctx: context }),
    });

    await expect(manager.switchTo("node")).rejects.toThrow(
      "node activation failed midway"
    );

    expect(commitMode).not.toHaveBeenCalled();
    expect(context.channels.deactivate).toHaveBeenCalledWith("n:station-1");
    expect(getPlaybackChannelRuntime("n:station-1").soundId).toBeNull();
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      phase: "active",
      requestedMode: null,
    });
  });

  test("a node session that is not ready rolls back without committing", async () => {
    insertPlaybackSession("single");
    const commitMode = mock((_mode: PlaybackSessionId) => undefined);
    const manager = createModeManager({
      commitMode,
      initialMode: "single",
      lifecycles: createModeLifecycleRegistry({
        ctx: createModeLifecycleTestContext(),
      }),
    });

    await expect(manager.switchTo("node")).rejects.toThrow(
      "Node playback session is not ready"
    );

    expect(commitMode).not.toHaveBeenCalled();
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      phase: "active",
    });
  });

  test("switching out of node leaves no n:* sound behind", async () => {
    insertPlaybackSession("single");
    insertNodeSession();
    const context = createModeLifecycleTestContext();
    const liveSoundIds = new Set<string>();
    context.channels.activate = mock(
      (_sessionId, channelId, _radio, soundId) => {
        const id = String(soundId);
        liveSoundIds.add(id);
        setPlaybackChannelRuntime(channelId, () => ({ soundId: id }));
        return id;
      }
    );
    context.audio.hasSound = mock((soundId: string) =>
      liveSoundIds.has(soundId)
    );
    context.audio.cleanupSound = mock((soundId: string) => {
      liveSoundIds.delete(soundId);
    });
    const fadeOut = mock((_soundId: string, _durationMs: number) =>
      Promise.resolve()
    );
    const manager = createModeManager({
      commitMode: mock(() => undefined),
      lifecycles: createModeLifecycleRegistry({
        ctx: context,
        fadeOutSound: fadeOut,
      }),
    });
    await manager.activateInitialMode("node");
    setPlaybackChannelRuntime("n:station-1", () => ({ isPlaying: true }));

    await manager.switchTo("single");

    expect(fadeOut).toHaveBeenCalledWith("node:n:station-1", 150, true);
    expect([...liveSoundIds].filter((id) => id.startsWith("node:"))).toEqual(
      []
    );
    expect(getPlaybackChannelRuntime("n:station-1")).toMatchObject({
      isPlaying: false,
      soundId: null,
    });
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      phase: "active",
    });
  });

  test("coalesces duplicate startup synchronization for the same mode", async () => {
    insertPlaybackSession("multiple");
    const releaseActivation = Promise.withResolvers<void>();
    const activateMultiple = mock(async () => {
      await releaseActivation.promise;
    });
    const manager = createModeManager({
      lifecycles: {
        dj: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        multiple: {
          activate: activateMultiple,
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        node: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        single: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
    });
    const requests = createModeLifecycleRequests({ manager });

    const firstSynchronization = requests.synchronizeMode("multiple");
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: null,
      phase: "activating",
      requestedMode: "multiple",
    });

    await requests.synchronizeMode("multiple");
    expect(activateMultiple).toHaveBeenCalledTimes(1);

    releaseActivation.resolve();
    await firstSynchronization;
  });

  test("waits for startup playback session readiness before activating mode", async () => {
    const activateInitialMode = mock(async (_mode: string) => undefined);
    const switchTo = mock(async (_mode: string) => undefined);
    const getSnapshot = mock(() => ({
      currentMode: null,
      error: null,
      phase: "inactive" as const,
      requestedMode: null,
    }));
    const manager = {
      activateInitialMode,
      getSnapshot,
      subscribe: mock((_listener: () => void) => () => undefined),
      switchTo,
    };

    const activation = createModeLifecycleRequests({ manager }).synchronizeMode(
      "multiple"
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(getSnapshot).not.toHaveBeenCalled();
    expect(activateInitialMode).not.toHaveBeenCalled();

    insertPlaybackSession("multiple");
    await activation;

    expect(activateInitialMode).toHaveBeenCalledWith("multiple");
    expect(switchTo).not.toHaveBeenCalled();
  });

  test("cancels stale mode synchronization after session readiness wait", async () => {
    await settingsCollection.stateWhenReady();
    insertSettings("multiple");
    const activateInitialMode = mock(async (_mode: string) => undefined);
    const switchTo = mock(async (_mode: string) => undefined);
    const manager = {
      activateInitialMode,
      getSnapshot: mock(() => ({
        currentMode: "single" as const,
        error: null,
        phase: "active" as const,
        requestedMode: null,
      })),
      subscribe: mock((_listener: () => void) => () => undefined),
      switchTo,
    };

    const synchronization = createModeLifecycleRequests({
      manager,
    }).synchronizeMode("multiple");
    await Promise.resolve();
    await Promise.resolve();

    settingsCollection.update("app-settings", (draft) => {
      draft.player.mode = "dj";
    });
    insertPlaybackSession("multiple");
    await synchronization;

    expect(manager.getSnapshot).not.toHaveBeenCalled();
    expect(activateInitialMode).not.toHaveBeenCalled();
    expect(switchTo).not.toHaveBeenCalled();
  });

  test("rejects concurrent mode switch requests through the lifecycle boundary", async () => {
    const releaseActivation = Promise.withResolvers<void>();
    const committedModes: string[] = [];
    const manager = createModeManager({
      commitMode: mock((mode) => {
        committedModes.push(mode);
      }),
      initialMode: "single",
      lifecycles: {
        dj: {
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
        node: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        single: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
    });

    const firstSwitch = manager.switchTo("multiple");

    await Promise.resolve();
    await Promise.resolve();
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      phase: "activating",
      requestedMode: "multiple",
    });
    expect(committedModes).toEqual([]);

    await expect(manager.switchTo("dj")).rejects.toThrow(
      "Mode transition in progress"
    );

    releaseActivation.resolve();
    await firstSwitch;

    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "multiple",
      phase: "active",
    });
    expect(committedModes).toEqual(["multiple"]);
  });

  test("rolls back to the previous active mode when activation fails", async () => {
    const commitMode = mock((_mode: string) => undefined);
    const singleActivate = mock(async () => undefined);
    const manager = createModeManager({
      commitMode,
      initialMode: "single",
      lifecycles: {
        dj: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        multiple: {
          activate: mock(() => Promise.reject(new Error("activation failed"))),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        node: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        single: {
          activate: singleActivate,
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
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
      commitMode,
      initialMode: "single",
      lifecycles: {
        dj: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        multiple: {
          activate: mock(async () => undefined),
          deactivate: multipleDeactivate,
          getPhase: () => "inactive",
        },
        node: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        single: {
          activate: singleActivate,
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
    });

    await expect(manager.switchTo("multiple")).rejects.toThrow(
      "settings commit failed"
    );

    expect(multipleDeactivate).toHaveBeenCalledTimes(1);
    expect(singleActivate).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      error: "Mode could not be changed. Try again.",
      phase: "active",
    });
  });

  test("restores the previous mode when failed-mode cleanup errors during rollback", async () => {
    const singleActivate = mock(async () => undefined);
    const multipleDeactivate = mock(() =>
      Promise.reject(new Error("cleanup failed"))
    );
    const manager = createModeManager({
      commitMode: mock(() => {
        throw new Error("settings commit failed");
      }),
      initialMode: "single",
      lifecycles: {
        dj: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        multiple: {
          activate: mock(async () => undefined),
          deactivate: multipleDeactivate,
          getPhase: () => "inactive",
        },
        node: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        single: {
          activate: singleActivate,
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
    });

    await expect(manager.switchTo("multiple")).rejects.toThrow(
      "settings commit failed"
    );

    expect(multipleDeactivate).toHaveBeenCalledTimes(1);
    expect(singleActivate).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      error: "Mode could not be changed. Try again.",
      phase: "active",
    });
  });

  test("surfaces safe mode transition errors without leaking implementation details", async () => {
    const manager = createModeManager({
      commitMode: mock(() => undefined),
      initialMode: "single",
      lifecycles: {
        dj: {
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
        node: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        single: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
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
      activeChannelId: null,
      channels: [
        createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a", 0),
        createDefaultChannel(DECK_B_CHANNEL_ID, "deck-b", 1),
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "dj",
      masterVolume: 0.5,
    });
    insertPlaybackSession("single");
    setPlaybackChannelRuntime(DECK_A_CHANNEL_ID, () => ({
      isPlaying: true,
      soundId: "left_station-1",
    }));
    setPlaybackChannelRuntime(DECK_B_CHANNEL_ID, () => ({
      isPlaying: true,
      soundId: "right_station-2",
    }));
    const context = createModeLifecycleTestContext();
    const fadeOut = mock((_soundId: string, _durationMs: number) =>
      Promise.resolve()
    );
    const manager = createModeManager({
      commitMode: mock(() => undefined),
      initialMode: "dj",
      lifecycles: createModeLifecycleRegistry({
        ctx: context,
        fadeOutDurationMs: 120,
        fadeOutSound: fadeOut,
      }),
    });

    await manager.switchTo("single");

    expect(fadeOut).toHaveBeenCalledWith("left_station-1", 120, true);
    expect(fadeOut).toHaveBeenCalledWith("right_station-2", 120, true);
    expect(getPlaybackChannelRuntime(DECK_A_CHANNEL_ID).soundId).toBeNull();
    expect(getPlaybackChannelRuntime(DECK_B_CHANNEL_ID).soundId).toBeNull();
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      phase: "active",
    });
  });

  test("switching modes cleans orphaned sounds owned by the deactivated mode", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      activeChannelId: "single-a",
      channels: [
        createDefaultChannel("single-a", "single-primary", 0),
        createDefaultChannel("single-b", "single-secondary", 1),
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "single",
      masterVolume: 0.5,
    });
    insertPlaybackSession("multiple");
    setPlaybackChannelRuntime("single-a", () => ({
      error: {
        code: "STREAM_ABORTED",
        id: "stale-error",
        message: "stale",
        timestamp: 1,
      },
      isBuffering: true,
      isLoading: true,
      isPlaying: true,
      soundId: "single:orphan",
    }));
    const context = createModeLifecycleTestContext();
    const liveSoundIds = new Set(["single:orphan"]);
    context.audio.hasSound = mock((soundId: string) =>
      liveSoundIds.has(soundId)
    );
    context.audio.cleanupSound = mock((soundId: string) => {
      liveSoundIds.delete(soundId);
    });
    const manager = createModeManager({
      commitMode: mock(() => undefined),
      initialMode: "single",
      lifecycles: createModeLifecycleRegistry({ ctx: context }),
    });

    await manager.switchTo("multiple");

    expect(context.audio.cleanupSound).toHaveBeenCalledWith("single:orphan");
    expect(getPlaybackChannelRuntime("single-a")).toMatchObject({
      error: null,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      soundId: null,
    });
  });

  test("switch cleanup preserves sounds that belong to the newly active mode", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      activeChannelId: "single-a",
      channels: [
        createDefaultChannel("single-a", "single-primary", 0),
        createDefaultChannel("single-b", "single-secondary", 1),
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "single",
      masterVolume: 0.5,
    });
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [
        {
          ...createDefaultChannel("multi:station-1", "multiple", 0),
          radio: stationRadio,
        },
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "multiple",
      masterVolume: 0.5,
    });
    setPlaybackChannelRuntime("single-a", () => ({
      isPlaying: true,
      soundId: "single:orphan",
    }));
    setPlaybackChannelRuntime("multi:station-1", () => ({
      isPlaying: true,
      soundId: "multiple:kept",
    }));
    const context = createModeLifecycleTestContext();
    const liveSoundIds = new Set(["single:orphan", "multiple:kept"]);
    context.audio.hasSound = mock((soundId: string) =>
      liveSoundIds.has(soundId)
    );
    context.audio.cleanupSound = mock((soundId: string) => {
      liveSoundIds.delete(soundId);
    });
    const manager = createModeManager({
      commitMode: mock(() => undefined),
      initialMode: "single",
      lifecycles: createModeLifecycleRegistry({ ctx: context }),
    });

    await manager.switchTo("multiple");

    expect(context.audio.cleanupSound).toHaveBeenCalledWith("single:orphan");
    expect(context.audio.cleanupSound).not.toHaveBeenCalledWith(
      "multiple:kept"
    );
    expect(getPlaybackChannelRuntime("multi:station-1").soundId).toBe(
      "multiple:kept"
    );
  });

  test("cleans partially activated mode runtime before rolling back", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      activeChannelId: "single-a",
      channels: [createDefaultChannel("single-a", "single-primary", 0)],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "single",
      masterVolume: 0.5,
    });
    playbackSessionsCollection.insert({
      activeChannelId: null,
      channels: [
        {
          ...createDefaultChannel("multi:station-1", "multiple", 0),
          radio: stationRadio,
        },
      ],
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      id: "multiple",
      masterVolume: 0.5,
    });
    const context = createModeLifecycleTestContext();
    context.channels.activate = mock((_sessionId, channelId) => {
      setPlaybackChannelRuntime(channelId, () => ({
        error: {
          code: "STREAM_ABORTED",
          id: "partial-error",
          message: "stale",
          timestamp: 1,
        },
        isBuffering: true,
        isLoading: true,
        isPlaying: true,
        soundId: "multiple:partial",
      }));
      throw new Error("activation failed midway");
    });
    const manager = createModeManager({
      commitMode: mock(() => undefined),
      initialMode: "single",
      lifecycles: createModeLifecycleRegistry({ ctx: context }),
    });

    await expect(manager.switchTo("multiple")).rejects.toThrow(
      "activation failed midway"
    );

    expect(context.channels.deactivate).toHaveBeenCalledWith("multi:station-1");
    expect(getPlaybackChannelRuntime("multi:station-1")).toMatchObject({
      error: null,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      soundId: null,
    });
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
      commitMode,
      lifecycles: {
        dj: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        multiple: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        node: {
          activate: mock(async () => undefined),
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
        single: {
          activate: activateSingle,
          deactivate: mock(async () => undefined),
          getPhase: () => "inactive",
        },
      },
    });

    await expect(manager.activateInitialMode("single")).rejects.toThrow(
      "session is not ready"
    );

    expect(manager.getSnapshot()).toMatchObject({
      currentMode: null,
      error: "Playback mode could not start. Try again.",
      phase: "inactive",
    });
    expect(commitMode).not.toHaveBeenCalled();

    await manager.activateInitialMode("single");

    expect(activateSingle).toHaveBeenCalledTimes(2);
    expect(commitMode).not.toHaveBeenCalled();
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      error: null,
      phase: "active",
    });
  });

  test("resets page lifecycle audio state through the mode lifecycle boundary", () => {
    const context = createModeLifecycleTestContext();
    context.lifecycle.mainOutputSettingsApplied = true;

    resetPlaybackLifecycleState(context);

    expect(context.channels.deactivateAll).toHaveBeenCalledTimes(1);
    expect(context.resetAudioManager).toHaveBeenCalledTimes(1);
    expect(context.lifecycle.mainOutputSettingsApplied as boolean).toBe(false);
  });
});
