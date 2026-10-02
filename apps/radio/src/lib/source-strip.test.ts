import { describe, expect, mock, test } from "bun:test";
import type { Radio } from "@/lib/audio/playback/types";
import { createBrowserAudioAdapter } from "./dj-deck";
import type { PlaybackActionContext } from "./playback-action-context";
import {
  clampSpeed,
  repeatAtEnd,
  seekSound,
  setPlaybackRate,
  setPreservesPitch,
  streamFormatOf,
} from "./source-strip";

function rateTarget() {
  return {
    setKeyLock: mock((_soundId: string, _keyLock: boolean) => undefined),
    setPlaybackRate: mock((_soundId: string, _rate: number) => undefined),
  };
}

describe("source strip", () => {
  test.each([
    [0.25, 0.5],
    [0.5, 0.5],
    [1.25, 1.25],
    [3, 2],
    [Number.NaN, 1],
  ])("clamps a speed of %p to %p", (speed, expected) => {
    expect(clampSpeed(speed)).toBe(expected);
    const audio = rateTarget();
    setPlaybackRate(audio, "sound", speed);
    expect(audio.setPlaybackRate).toHaveBeenCalledWith("sound", expected);
  });

  test("key lock sets the sound's pitch preservation", () => {
    const audio = rateTarget();
    setPreservesPitch(audio, "sound", false);
    expect(audio.setKeyLock).toHaveBeenCalledWith("sound", false);
  });

  test("a seek never goes before the start", () => {
    const playback = { seek: mock((_id: string, _at: number) => undefined) };
    seekSound(playback, "sound", -4);
    seekSound(playback, "sound", 61.5);
    expect(playback.seek.mock.calls).toEqual([
      ["sound", 0],
      ["sound", 61.5],
    ]);
  });

  test("repeat seeks to the start, then plays", async () => {
    const steps: string[] = [];
    const repeated = await repeatAtEnd({
      isCurrent: () => true,
      play: () => {
        steps.push("play");
        return Promise.resolve();
      },
      seek: () => {
        steps.push("seek");
      },
    });
    expect(repeated).toBe(true);
    expect(steps).toEqual(["seek", "play"]);
  });

  test("repeat stops when the sound was replaced after its seek", async () => {
    const play = mock(async () => undefined);
    const repeated = await repeatAtEnd({
      isCurrent: () => false,
      play,
      seek: () => undefined,
    });
    expect(repeated).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });

  test("names a stream HLS or progressive the way a DJ deck loads it", () => {
    const station: Radio = {
      name: "Station",
      streamUrl: "https://radio.example/live.mp3",
    };
    expect(streamFormatOf(station, station.streamUrl)).toBe("progressive");
    expect(
      streamFormatOf(
        { ...station, streamUrl: "https://radio.example/live.m3u8" },
        "https://radio.example/live.m3u8"
      )
    ).toBe("hls");
    expect(
      streamFormatOf(
        {
          ...station,
          platformMetadata: {
            hls: true,
            itemType: "station",
            platform: "radio-browser",
            stationUuid: "uuid",
            url: station.streamUrl,
          },
        },
        station.streamUrl
      )
    ).toBe("hls");
  });

  test("a DJ deck's speed and seek go through the shared strip calls", async () => {
    const audio = rateTarget();
    const seek = mock((_soundId: string, _position: number) => undefined);
    const adapter = createBrowserAudioAdapter({
      audio,
      audioEngine: { playback: { seek } },
    } as unknown as PlaybackActionContext);

    adapter.change("deck-sound", { speed: 3, type: "speed" });
    await adapter.transport("deck-sound", { position: -1, type: "seek" });

    expect(audio.setPlaybackRate).toHaveBeenCalledWith("deck-sound", 2);
    expect(seek).toHaveBeenCalledWith("deck-sound", 0);
  });
});
