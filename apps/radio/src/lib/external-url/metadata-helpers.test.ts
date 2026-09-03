import { describe, expect, test } from "bun:test";
import type { PlatformMetadata } from "@/lib/platform-types";
import { getCurrentTrackIndex, isCollection } from "./metadata-helpers";

describe("isCollection", () => {
  test("treats Bandcamp collection as collection metadata", () => {
    const metadata = {
      platform: "bandcamp",
      itemType: "collection",
      url: "https://bandcamp.com/example",
      tracks: [],
    } as PlatformMetadata;

    expect(isCollection(metadata)).toBeTrue();
  });
});

describe("getCurrentTrackIndex", () => {
  test("finds the selected static-audio playlist track", () => {
    expect(
      getCurrentTrackIndex(
        {
          displayName: "Playlist",
          duration: 0,
          fileName: "playlist.m3u",
          fileSize: 0,
          isLocal: false,
          itemType: "playlist",
          mimeType: "audio/x-mpegurl",
          platform: "static-audio",
          streamUrl: "https://audio.example/one.mp3",
          tracks: [
            { streamUrl: "https://audio.example/one.mp3", title: "One" },
            { streamUrl: "https://audio.example/two.mp3", title: "Two" },
          ],
          url: "https://audio.example/playlist.m3u",
        },
        "https://audio.example/two.mp3"
      )
    ).toBe(1);
  });

  test("resolves track index for Bandcamp collection entries", () => {
    const metadata = {
      platform: "bandcamp",
      itemType: "collection",
      url: "https://bandcamp.com/example",
      tracks: [
        { name: "Track 1", streamUrl: "https://radio.example/1.mp3" },
        { name: "Track 2", streamUrl: "https://radio.example/2.mp3" },
      ],
    } as PlatformMetadata;

    expect(getCurrentTrackIndex(metadata, "https://radio.example/2.mp3")).toBe(
      1
    );
  });
});
