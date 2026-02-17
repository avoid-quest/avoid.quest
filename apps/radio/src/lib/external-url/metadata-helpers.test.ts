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
