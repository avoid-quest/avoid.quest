import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioManager } from "@/lib/audio";
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
  return {
    audio: {
      hasSound: mock((_soundId: string) => false),
      setGlobalVolume: mock((_volume: number) => undefined),
      setMainDelay: mock((_delayMs: number) => undefined),
      ...overrides,
    } as unknown as AudioManager,
    channels: {
      activate: mock(
        (
          _sessionId,
          _channelId,
          _radio,
          optionsOrSoundId?: string | { soundId?: string }
        ) => {
          return typeof optionsOrSoundId === "string"
            ? optionsOrSoundId
            : (optionsOrSoundId?.soundId ?? "sound");
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
});
