import { afterEach, describe, expect, test } from "bun:test";
import {
  getPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { resetManagedAudioState } from "./playback-actions-shared";

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
