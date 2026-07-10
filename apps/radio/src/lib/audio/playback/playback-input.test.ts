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
});
