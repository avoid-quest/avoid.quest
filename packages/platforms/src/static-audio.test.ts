import { describe, expect, test } from "bun:test";
import {
  getFilenameFromUrl,
  isAudioUrl,
  isPlaylistUrl,
  isStaticAudioUrl,
} from "./static-audio";

describe("static audio URL policy", () => {
  test("detects audio and playlist URLs by pathname extension", () => {
    expect(isAudioUrl("https://example.com/Mix-01.MP3?download=1")).toBe(true);
    expect(isPlaylistUrl("https://example.com/live/radio.m3u8")).toBe(true);
    expect(isStaticAudioUrl("https://example.com/live/radio.m3u8")).toBe(true);
    expect(isStaticAudioUrl("https://example.com/archive")).toBe(false);
  });

  test("extracts display filenames using the existing cleanup policy", () => {
    expect(
      getFilenameFromUrl("https://example.com/audio/deep_mix-01.mp3")
    ).toBe("deep mix 01");
    expect(getFilenameFromUrl("not a url")).toBe("Unknown");
  });
});
