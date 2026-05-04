import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type AudioEngineFacade,
  type AudioManager,
  AudioManager as AudioManagerClass,
} from "@/lib/audio";
import {
  createDefaultChannel,
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
} from "./mode-lifecycle-manager";
import type { PlaybackActionContext } from "./playback-action-context";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
}

function createTestContext(overrides: Partial<AudioManager> = {}) {
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
      ...overrides,
    } as unknown as AudioManager,
    audioEngine,
    channels: {
      activate: mock(
        (
          _sessionId,
          _channelId,
          _radio,
          optionsOrSoundId?: string | { soundId?: string }
        ) => {
          const soundId =
            typeof optionsOrSoundId === "string"
              ? optionsOrSoundId
              : (optionsOrSoundId?.soundId ?? "sound");
          setPlaybackChannelRuntime(_channelId, () => ({ soundId }));
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
  test("serializes concurrent mode switch requests", async () => {
    const releaseActivation = Promise.withResolvers<void>();
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
      commitMode: mock(() => undefined),
    });

    const firstSwitch = manager.switchTo("multiple");
    const rejectedSwitch = manager.switchTo("dj");

    await expect(rejectedSwitch).rejects.toThrow("Mode transition in progress");
    releaseActivation.resolve();
    await firstSwitch;

    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "multiple",
      phase: "active",
    });
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

  test("keeps initial DJ activation retryable until the session exists", async () => {
    const manager = createModeManager({
      lifecycles: createModeLifecycleRegistry({
        ctx: createTestContext(),
      }),
      commitMode: mock(() => undefined),
    });

    await expect(manager.activateInitialMode("dj")).rejects.toThrow(
      "DJ playback session is not ready"
    );

    expect(manager.getSnapshot()).toMatchObject({
      currentMode: null,
      phase: "inactive",
    });
  });

  test("keeps initial single activation retryable until the session exists and restores its active sound", async () => {
    const context = createTestContext();
    const manager = createModeManager({
      lifecycles: createModeLifecycleRegistry({
        ctx: context,
      }),
      commitMode: mock(() => undefined),
    });

    await expect(manager.activateInitialMode("single")).rejects.toThrow(
      "Single playback session is not ready"
    );

    expect(manager.getSnapshot()).toMatchObject({
      currentMode: null,
      phase: "inactive",
    });

    await playbackSessionsCollection.stateWhenReady();
    const radio = {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/station.mp3",
    };
    playbackSessionsCollection.insert({
      id: "single",
      channels: [
        {
          ...createDefaultChannel("single-a", "single-primary", 0),
          radio,
        },
      ],
      masterVolume: 0.6,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: "single-a",
    });

    await manager.activateInitialMode("single");

    expect(context.channels.activate).toHaveBeenCalledWith(
      "single",
      "single-a",
      radio,
      "single:single-a"
    );
    expect(context.audio.setGlobalVolume).toHaveBeenCalledWith(0.6);
    expect(getPlaybackChannelRuntime("single-a").soundId).toBe(
      "single:single-a"
    );
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "single",
      phase: "active",
      error: null,
    });
  });

  test("keeps initial multiple activation retryable until the session exists and restores channel sounds", async () => {
    const context = createTestContext();
    const manager = createModeManager({
      lifecycles: createModeLifecycleRegistry({ ctx: context }),
      commitMode: mock(() => undefined),
    });

    await expect(manager.activateInitialMode("multiple")).rejects.toThrow(
      "Multiple playback session is not ready"
    );

    expect(manager.getSnapshot()).toMatchObject({
      currentMode: null,
      phase: "inactive",
    });

    await playbackSessionsCollection.stateWhenReady();
    const radioOne = {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/station-1.mp3",
    };
    const radioTwo = {
      id: "station-2",
      name: "Station 2",
      streamUrl: "https://radio.example/station-2.mp3",
    };
    playbackSessionsCollection.insert({
      id: "multiple",
      channels: [
        {
          ...createDefaultChannel("multi:station-1", "multiple", 0),
          radio: radioOne,
        },
        {
          ...createDefaultChannel("multi:station-2", "multiple", 1),
          radio: radioTwo,
        },
        createDefaultChannel("multi:empty", "multiple", 2),
      ],
      masterVolume: 0.8,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: null,
    });

    await manager.activateInitialMode("multiple");

    expect(context.channels.activate).toHaveBeenCalledTimes(2);
    expect(context.channels.activate).toHaveBeenCalledWith(
      "multiple",
      "multi:station-1",
      radioOne,
      "multiple:multi:station-1"
    );
    expect(context.channels.activate).toHaveBeenCalledWith(
      "multiple",
      "multi:station-2",
      radioTwo,
      "multiple:multi:station-2"
    );
    expect(context.audio.setGlobalVolume).toHaveBeenCalledWith(0.8);
    expect(getPlaybackChannelRuntime("multi:station-1").soundId).toBe(
      "multiple:multi:station-1"
    );
    expect(getPlaybackChannelRuntime("multi:station-2").soundId).toBe(
      "multiple:multi:station-2"
    );
    expect(getPlaybackChannelRuntime("multi:empty").soundId).toBeNull();
    expect(manager.getSnapshot()).toMatchObject({
      currentMode: "multiple",
      phase: "active",
      error: null,
    });
  });

  test("deactivation fades managed sounds, clears runtime state, and checks orphans", async () => {
    await playbackSessionsCollection.stateWhenReady();
    playbackSessionsCollection.insert({
      id: "single",
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
      masterVolume: 0.5,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: "single-a",
    });
    setPlaybackChannelRuntime("single-a", () => ({
      error: {
        id: "err-1",
        message: "stale",
        code: "PLAY_ERROR",
        timestamp: Date.now(),
      },
      soundId: "single:single-a",
    }));

    const fadeOut = mock((_soundId: string, _duration: number) =>
      Promise.resolve()
    );
    const context = createTestContext();
    const lifecycles = createModeLifecycleRegistry({
      ctx: context,
      fadeOutSound: fadeOut,
      fadeOutDurationMs: 150,
    });

    await lifecycles.single.deactivate();

    expect(fadeOut).toHaveBeenCalledWith("single:single-a", 150, true);
    expect(context.channels.deactivate).toHaveBeenCalledWith("single-a");
    expect(context.audio.hasSound).toHaveBeenCalledWith("single:single-a");
    expect(getPlaybackChannelRuntime("single-a").error).toBeNull();
    expect(getPlaybackChannelRuntime("single-a").soundId).toBeNull();
  });

  test("activates DJ mode with the provided playback context", async () => {
    await playbackSessionsCollection.stateWhenReady();
    const radio = {
      id: "station-1",
      name: "Station 1",
      streamUrl: "https://radio.example/station.mp3",
    };
    playbackSessionsCollection.insert({
      id: "dj",
      channels: [
        {
          ...createDefaultChannel("deck-a", "deck-a", 0),
          radio,
        },
        createDefaultChannel("deck-b", "deck-b", 1),
      ],
      masterVolume: 0.7,
      crossfadePosition: 0.25,
      headphoneVolume: 1,
      activeChannelId: null,
    });
    const context = createTestContext();
    const originalGetInstance = AudioManagerClass.getInstance;
    AudioManagerClass.getInstance = mock(() => {
      throw new Error("AudioManager singleton should not be used");
    }) as typeof AudioManagerClass.getInstance;

    try {
      const lifecycles = createModeLifecycleRegistry({ ctx: context });

      await lifecycles.dj.activate();
    } finally {
      AudioManagerClass.getInstance = originalGetInstance;
    }

    expect(context.channels.activate).toHaveBeenCalledWith(
      "dj",
      "deck-a",
      radio,
      expect.objectContaining({ soundId: "left_station-1" })
    );
    expect(context.audio.setGlobalVolume).toHaveBeenCalledWith(0.7);
  });
});
