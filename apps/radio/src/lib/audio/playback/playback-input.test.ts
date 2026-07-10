import { describe, expect, test } from "bun:test";
import { toPlaybackInput } from "./playback-input";

describe("toPlaybackInput", () => {
  test("uses the resolved URL as the only playback source", () => {
    expect(
      toPlaybackInput({
        id: "radio",
        name: "Radio",
        streamUrl: "https://radio.example/live",
      })
    ).toEqual({
      format: "progressive",
      src: "https://radio.example/live",
    });
  });

  test("preserves explicit HLS format and omits credentials for YouTube", () => {
    expect(
      toPlaybackInput({
        id: "youtube",
        name: "YouTube",
        platformMetadata: {
          itemType: "video",
          name: "Track",
          platform: "youtube",
          url: "https://youtube.com/watch?v=abcdefghijk",
          videoId: "abcdefghijk",
        },
        streamFormat: "hls",
        streamUrl: "https://provider.example/audio",
      })
    ).toEqual({
      credentials: "omit",
      format: "hls",
      src: "https://provider.example/audio",
    });
  });

  test("allows native HLS only for curated or allowlisted sources", () => {
    expect(
      toPlaybackInput({
        name: "Same-origin HLS",
        streamFormat: "hls",
        streamUrl: "/audio/live.m3u8",
      })
    ).toMatchObject({ allowNativeHls: true });
    expect(
      toPlaybackInput({
        name: "SoundCloud HLS",
        platformMetadata: {
          itemType: "track",
          platform: "soundcloud",
          url: "https://soundcloud.com/artist/track",
        },
        streamFormat: "hls",
        streamUrl: "https://cf-hls-media.sndcdn.com/live.m3u8",
      })
    ).toMatchObject({ allowNativeHls: true });
    expect(
      toPlaybackInput({
        name: "Untrusted HLS",
        streamFormat: "hls",
        streamUrl: "https://unknown.example/live.m3u8",
      })
    ).not.toHaveProperty("allowNativeHls");
    expect(
      toPlaybackInput({
        name: "Spoofed SoundCloud HLS",
        platformMetadata: {
          itemType: "track",
          platform: "soundcloud",
          url: "https://soundcloud.com/artist/track",
        },
        streamFormat: "hls",
        streamUrl: "https://unknown.example/live.m3u8",
      })
    ).not.toHaveProperty("allowNativeHls");
    expect(
      toPlaybackInput({
        name: "Scheme-relative HLS",
        streamFormat: "hls",
        streamUrl: "//unknown.example/live.m3u8",
      })
    ).not.toHaveProperty("allowNativeHls");
    expect(
      toPlaybackInput({
        name: "Control-character HLS",
        streamFormat: "hls",
        streamUrl: "/\n/unknown.example/live.m3u8",
      })
    ).not.toHaveProperty("allowNativeHls");
  });
});
