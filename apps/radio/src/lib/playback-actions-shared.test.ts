import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AudioManager } from "@/lib/audio";
import {
  getAudioSettings,
  initializeSettings,
  setMainOutputDevice,
  settingsCollection,
} from "@/lib/collections/settings";
import {
  getPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import type { PlaybackActionContext } from "./playback-action-context";
import {
  applyCurrentMainAudioSettings,
  applyMainOutputDevice,
  resetManagedAudioState,
} from "./playback-actions-shared";

async function resetSettings() {
  await settingsCollection.stateWhenReady();

  for (const settingsId of Array.from(settingsCollection.state.keys())) {
    settingsCollection.delete(settingsId);
  }

  await initializeSettings();
}

function createContext(
  setMainOutput: (deviceId: string) => Promise<void> | void
) {
  const router = {
    setMainOutput: mock(setMainOutput),
  };
  const context: PlaybackActionContext = {
    audio: {
      setGlobalVolume: mock((_volume: number) => undefined),
      setMainDelay: mock((_delayMs: number) => undefined),
    } as unknown as AudioManager,
    audioEngine: {} as PlaybackActionContext["audioEngine"],
    channels: {} as PlaybackActionContext["channels"],
    getMainOutputRouter: () =>
      router as unknown as ReturnType<
        PlaybackActionContext["getMainOutputRouter"]
      >,
    lifecycle: { mainOutputSettingsApplied: false },
    reportError: mock(() => undefined),
    resetAudioManager: mock(() => undefined),
  };

  return { context, router };
}

beforeEach(async () => {
  await resetSettings();
});

afterEach(async () => {
  await resetSettings();
});

describe("resetManagedAudioState", () => {
  test("clears playback runtime alongside the audio manager reset", () => {
    setPlaybackChannelRuntime("single:primary", () => ({
      error: null,
      isBuffering: true,
      isLoading: false,
      isPlaying: true,
      soundId: "single:primary",
    }));

    resetManagedAudioState();

    expect(getPlaybackChannelRuntime("single:primary")).toEqual({
      error: null,
      isBuffering: false,
      isLoading: false,
      isPlaying: false,
      peakLevel: { left: 0, right: 0 },
      soundId: null,
    });
  });
});

describe("playback shared audio routing", () => {
  test("falls back to the default output when a persisted main output is stale", async () => {
    setMainOutputDevice("missing-output-device");

    const { context, router } = createContext((deviceId) => {
      if (deviceId === "missing-output-device") {
        throw new DOMException(
          "AudioContext.setSinkId(): failed: the device missing-output-device is not found.",
          "NotFoundError"
        );
      }
    });

    await applyCurrentMainAudioSettings(context);

    expect(router.setMainOutput).toHaveBeenCalledTimes(2);
    expect(router.setMainOutput).toHaveBeenNthCalledWith(
      1,
      "missing-output-device"
    );
    expect(router.setMainOutput).toHaveBeenNthCalledWith(2, "default");
    expect(getAudioSettings().mainOutputId).toBe("default");
    expect(context.audio.setMainDelay).toHaveBeenCalledWith(0);
    expect(context.lifecycle.mainOutputSettingsApplied).toBe(true);
  });

  test("explicit main output changes also recover to default on setSinkId failure", async () => {
    setMainOutputDevice("stale-user-choice");

    const { context, router } = createContext((deviceId) => {
      if (deviceId === "stale-user-choice") {
        throw new DOMException("Device not found", "NotFoundError");
      }
    });

    await applyMainOutputDevice("stale-user-choice", context);

    expect(router.setMainOutput).toHaveBeenNthCalledWith(
      1,
      "stale-user-choice"
    );
    expect(router.setMainOutput).toHaveBeenNthCalledWith(2, "default");
    expect(getAudioSettings().mainOutputId).toBe("default");
  });
});
