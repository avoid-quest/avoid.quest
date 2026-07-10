import { describe, expect, test } from "bun:test";
import type { Platform } from "@/lib/platform-types";
import {
  calculateHasTracklist,
  isStreamingMetadata,
  resolveDeckPanelContentKind,
} from "./deck-panel-helpers";

describe("resolveDeckPanelContentKind", () => {
  test("prioritizes pending source forms over an already-loaded radio", () => {
    const cases: [Platform, ReturnType<typeof resolveDeckPanelContentKind>][] =
      [
        ["device-input", "pending-device"],
        ["local-file", "pending-file"],
        ["static-audio", "pending-file"],
        ["bandcamp", "pending-external"],
        ["soundcloud", "pending-external"],
        ["youtube", "pending-external"],
        ["radiogarden", "pending-external"],
        ["external", "pending-external"],
      ];

    for (const [platform, expected] of cases) {
      expect(resolveDeckPanelContentKind(true, platform)).toBe(expected);
    }
  });

  test("returns to the loaded radio after the pending source is dismissed", () => {
    expect(resolveDeckPanelContentKind(true)).toBe("loaded");
    expect(resolveDeckPanelContentKind(false)).toBe("empty");
  });

  test("shows resolved static-audio playlists as tracklists", () => {
    const metadata = {
      displayName: "Playlist",
      duration: 0,
      fileName: "playlist.m3u",
      fileSize: 0,
      isLocal: false,
      itemType: "playlist" as const,
      mimeType: "audio/x-mpegurl",
      platform: "static-audio" as const,
      streamUrl: "https://audio.example/one.mp3",
      tracks: [{ streamUrl: "https://audio.example/one.mp3", title: "One" }],
      url: "https://audio.example/playlist.m3u",
    };

    expect(isStreamingMetadata(metadata)).toBe(true);
    expect(calculateHasTracklist(metadata)).toBe(true);
  });
});
