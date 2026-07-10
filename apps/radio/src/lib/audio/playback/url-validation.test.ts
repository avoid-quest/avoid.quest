import { describe, expect, test } from "bun:test";
import {
  isValidPlaybackStreamUrl,
  validatePlaybackStreamUrl,
} from "./url-validation";

describe("validatePlaybackStreamUrl", () => {
  test("accepts standard http/https stream URLs", () => {
    expect(
      validatePlaybackStreamUrl("https://radio.example/stream.mp3")
    ).toEqual({
      ok: true,
      normalizedUrl: "https://radio.example/stream.mp3",
    });
    expect(isValidPlaybackStreamUrl("http://radio.example/live")).toBeTrue();
  });

  test("normalizes and accepts lazy YouTube IDs", () => {
    expect(validatePlaybackStreamUrl("  yt:dQw4w9WgXcQ  ")).toEqual({
      ok: true,
      normalizedUrl: "yt:dQw4w9WgXcQ",
    });
  });

  test("rejects reserved deck-side tokens", () => {
    expect(validatePlaybackStreamUrl("right")).toEqual({
      ok: false,
      reason: "reserved token cannot be used as stream URL",
    });
    expect(isValidPlaybackStreamUrl("left")).toBeFalse();
  });

  test("accepts relative same-origin paths", () => {
    expect(validatePlaybackStreamUrl("/audio/track.mp3")).toEqual({
      ok: true,
      normalizedUrl: "/audio/track.mp3",
    });
    expect(isValidPlaybackStreamUrl("/audio/live.m3u8")).toBeTrue();
  });

  test("rejects unsupported protocols and invalid URLs", () => {
    expect(validatePlaybackStreamUrl("ftp://radio.example/stream")).toEqual({
      ok: false,
      reason: "unsupported protocol: ftp:",
    });
    expect(validatePlaybackStreamUrl("not a url")).toEqual({
      ok: false,
      reason: "invalid URL format",
    });
  });
});
