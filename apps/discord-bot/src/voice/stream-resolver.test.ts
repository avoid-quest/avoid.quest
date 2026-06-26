import { describe, expect, test } from "bun:test";
import { resolveStaticAudioItem } from "./stream-resolver";

describe("resolveStaticAudioItem", () => {
  test("rejects playlist URLs for Discord direct audio", async () => {
    await expect(
      resolveStaticAudioItem("https://audio.example/live/playlist.m3u8")
    ).rejects.toThrow(
      "Discord direct audio URLs must point to an audio file, not a playlist."
    );
  });
});
