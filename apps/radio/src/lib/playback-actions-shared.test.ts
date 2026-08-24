import { afterEach, describe, expect, test } from "bun:test";
import {
  getPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import type { OutputRouting } from "./output-routing";
import type { PlaybackActionContext } from "./playback-action-context";
import {
  applyCurrentMainAudioSettings,
  resetManagedAudioState,
} from "./playback-actions-shared";

afterEach(() => {
  resetManagedAudioState();
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

describe("managed playback output routing", () => {
  test("reconciles only main output settings during activation", async () => {
    const patches: unknown[] = [];
    const routing = {
      applyMainSettings: (patch: unknown) => {
        patches.push(patch);
        return Promise.resolve({});
      },
      applySettings: () => {
        throw new Error("full output transaction should not run");
      },
    } as unknown as OutputRouting;
    const context = {
      getMainOutputRouter: () => routing,
      lifecycle: { mainOutputSettingsApplied: false },
    } as PlaybackActionContext;

    await applyCurrentMainAudioSettings(context);

    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      mainDelayMs: expect.any(Number),
      mainOutputId: expect.any(String),
    });
    expect(context.lifecycle.mainOutputSettingsApplied).toBe(true);
  });
});
