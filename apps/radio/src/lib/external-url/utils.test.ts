import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import { PlatformModeError, validateRadioForMode } from "./utils";

const youtube: Radio = {
  id: "yt-1",
  name: "A video",
  platformMetadata: {
    itemType: "video",
    platform: "youtube",
    url: "https://www.youtube.com/watch?v=abc",
    videoId: "abc",
  },
  streamUrl: "https://media.example/abc.m4a",
};

const station: Radio = {
  id: "kexp",
  name: "KEXP",
  streamUrl: "https://kexp.example/live.mp3",
};

describe("validateRadioForMode", () => {
  test("Single still refuses a platform track", () => {
    expect(() => validateRadioForMode(youtube, "single")).toThrow(
      PlatformModeError
    );
  });

  test("DJ and Node play a platform track", () => {
    expect(() => validateRadioForMode(youtube, "dj")).not.toThrow();
    expect(() => validateRadioForMode(youtube, "node")).not.toThrow();
  });

  test("a live station plays in every mode", () => {
    for (const mode of ["single", "dj", "node"] as const) {
      expect(() => validateRadioForMode(station, mode)).not.toThrow();
    }
  });
});
