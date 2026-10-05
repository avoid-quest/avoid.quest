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
      normalizedUrl: "https://radio.example/stream.mp3",
      ok: true,
    });
    expect(isValidPlaybackStreamUrl("http://radio.example/live")).toBeTrue();
  });

  test("normalizes and accepts lazy YouTube IDs", () => {
    expect(validatePlaybackStreamUrl("  yt:dQw4w9WgXcQ  ")).toEqual({
      normalizedUrl: "yt:dQw4w9WgXcQ",
      ok: true,
    });
  });

  test("accepts unmatched Spotify tracks and no other Spotify URI", () => {
    expect(
      validatePlaybackStreamUrl(" spotify:track:4Z1olDl8aym5xZYZAat672 ")
    ).toEqual({
      normalizedUrl: "spotify:track:4Z1olDl8aym5xZYZAat672",
      ok: true,
    });
    expect(
      isValidPlaybackStreamUrl("spotify:album:2noRn2Aes5aoNVsU6iWThc")
    ).toBeFalse();
    expect(isValidPlaybackStreamUrl("spotify:track:short")).toBeFalse();
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
      normalizedUrl: "/audio/track.mp3",
      ok: true,
    });
    expect(isValidPlaybackStreamUrl("/audio/live.m3u8")).toBeTrue();
    expect(isValidPlaybackStreamUrl("//evil.example/live.m3u8")).toBeFalse();
    expect(isValidPlaybackStreamUrl("/\\evil.example/live.m3u8")).toBeFalse();
    expect(isValidPlaybackStreamUrl("/\n/evil.example/live.m3u8")).toBeFalse();
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
