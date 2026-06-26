import { describe, expect, mock, test } from "bun:test";
import { resolveStaticAudioItem } from "./stream-resolver";

describe("resolveStaticAudioItem", () => {
  test("rejects playlist URLs for Discord direct audio", async () => {
    await expect(
      resolveStaticAudioItem("https://audio.example/live/playlist.m3u8")
    ).rejects.toThrow(
      "Discord direct audio URLs must point to an audio file, not a playlist."
    );
  });

  test("does not resolve hostnames during command-time direct audio validation", async () => {
    const originalFetch = globalThis.fetch;
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      throw new Error("Static audio resolution should not fetch DNS records");
    });

    try {
      globalThis.fetch = fetchImpl as typeof fetch;

      await expect(
        resolveStaticAudioItem("https://audio.example/live.mp3")
      ).resolves.toEqual({
        metadata: {
          platform: "static-audio",
          url: "https://audio.example/live.mp3",
        },
        streamUrl: "https://audio.example/live.mp3",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
