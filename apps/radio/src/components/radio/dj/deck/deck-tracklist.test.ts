import { describe, expect, test } from "bun:test";
import type { PlatformTrack } from "@/lib/platform-types";
import { getTrackPlayUrl } from "./deck-tracklist";

describe("getTrackPlayUrl", () => {
  test("returns concrete stream URL when present", () => {
    const track = {
      name: "Track 1",
      streamUrl: "https://radio.example/stream.mp3",
    } as PlatformTrack;

    expect(getTrackPlayUrl(track)).toBe("https://radio.example/stream.mp3");
  });

  test("falls back to yt:{videoId} when stream URL is empty", () => {
    const track = {
      name: "Track 2",
      streamUrl: "",
      videoId: "dQw4w9WgXcQ",
    } as PlatformTrack;

    expect(getTrackPlayUrl(track)).toBe("yt:dQw4w9WgXcQ");
  });

  test("returns empty string when no playable URL exists", () => {
    const track = {
      name: "Track 3",
      streamUrl: "",
    } as PlatformTrack;

    expect(getTrackPlayUrl(track)).toBe("");
  });
});
