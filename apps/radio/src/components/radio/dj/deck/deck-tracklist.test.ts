import { describe, expect, test } from "bun:test";
import type { PlatformTrack } from "@/lib/platform-types";
import { findTrackPlayUrlInDirection, getTrackPlayUrl } from "./deck-tracklist";

describe("getTrackPlayUrl", () => {
  test("returns static-audio playlist track URLs", () => {
    expect(
      getTrackPlayUrl({
        streamUrl: "https://audio.example/live.m3u8",
        title: "Live",
      })
    ).toBe("https://audio.example/live.m3u8");
  });

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

  test("returns empty string for reserved deck-side tokens", () => {
    const track = {
      name: "Track 4",
      streamUrl: "right",
    } as PlatformTrack;

    expect(getTrackPlayUrl(track)).toBe("");
  });
});

describe("findTrackPlayUrlInDirection", () => {
  const tracks = [
    { name: "Track 1", streamUrl: "https://radio.example/1.mp3" },
    { name: "Track 2", streamUrl: "right" },
    { name: "Track 3", streamUrl: "https://radio.example/3.mp3" },
  ] as PlatformTrack[];

  test("skips invalid next entries and returns the next playable URL", () => {
    expect(findTrackPlayUrlInDirection(tracks, 0, 1)).toBe(
      "https://radio.example/3.mp3"
    );
  });

  test("returns empty string when there is no playable URL in direction", () => {
    expect(findTrackPlayUrlInDirection(tracks, 2, 1)).toBe("");
  });
});
