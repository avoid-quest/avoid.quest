import { afterEach, describe, expect, mock, test } from "bun:test";
import { AudioManager } from "@/lib/audio";
import {
  getPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";
import { activateChannel } from "./channel-state-manager";
import { resetManagedAudioState } from "./playback-actions-shared";

afterEach(() => {
  resetManagedAudioState();
  AudioManager.resetInstance();
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

  test("routes active channel cleanup through the channel lifecycle", () => {
    const manager = AudioManager.getInstance();
    const subscriptionCleanup = mock(() => undefined);
    manager.createSound = mock(
      (_radio, soundId?: string) => soundId ?? "sound"
    );
    manager.cleanupSound = mock((_soundId: string) => undefined);
    manager.subscribe = mock((_soundId, _callback) => subscriptionCleanup);
    manager.subscribeMeter = mock((_soundId, _callback) =>
      mock(() => undefined)
    );

    activateChannel(
      "single",
      "single:primary",
      {
        id: "station-1",
        name: "Station 1",
        streamUrl: "https://radio.example/station.mp3",
      },
      "single:primary"
    );

    resetManagedAudioState();

    expect(subscriptionCleanup).toHaveBeenCalledTimes(1);
    expect(manager.cleanupSound).toHaveBeenCalledWith("single:primary");
    expect(getPlaybackChannelRuntime("single:primary").soundId).toBeNull();
  });
});
