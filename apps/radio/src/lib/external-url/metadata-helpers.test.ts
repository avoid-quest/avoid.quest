import { describe, expect, test } from "bun:test";
import type { PlatformMetadata } from "@/lib/platform-types";
import {
  getCurrentTrackIndex,
  isCollection,
  isCollectionItem,
} from "./metadata-helpers";

describe("isCollection", () => {
  test("treats Bandcamp artists and SoundCloud users as tracklists", () => {
    for (const [platform, itemType] of [
      ["bandcamp", "album"],
      ["bandcamp", "artist"],
      ["bandcamp", "collection"],
      ["soundcloud", "playlist"],
      ["soundcloud", "user"],
      ["youtube", "playlist"],
      ["static-audio", "playlist"],
    ]) {
      expect(isCollectionItem(platform, itemType)).toBeTrue();
    }
    for (const [platform, itemType] of [
      ["bandcamp", "track"],
      ["soundcloud", "track"],
      ["youtube", "video"],
      ["radiogarden", "channel"],
    ]) {
      expect(isCollectionItem(platform, itemType)).toBeFalse();
    }
  });

  test("finds the clicked track inside a SoundCloud user's tracks", () => {
    const metadata = {
      itemType: "user",
      platform: "soundcloud",
      tracks: [
        { name: "One", streamUrl: "https://radio.example/1.mp3" },
        { name: "Two", streamUrl: "https://radio.example/2.mp3" },
        { name: "Three", streamUrl: "https://radio.example/3.mp3" },
      ],
      url: "https://soundcloud.com/example",
    } as PlatformMetadata;

    expect(isCollection(metadata)).toBeTrue();
    expect(getCurrentTrackIndex(metadata, "https://radio.example/3.mp3")).toBe(
      2
    );
  });

  test("treats Bandcamp collection as collection metadata", () => {
    const metadata = {
      itemType: "collection",
      platform: "bandcamp",
      tracks: [],
      url: "https://bandcamp.com/example",
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
      itemType: "collection",
      platform: "bandcamp",
      tracks: [
        { name: "Track 1", streamUrl: "https://radio.example/1.mp3" },
        { name: "Track 2", streamUrl: "https://radio.example/2.mp3" },
      ],
      url: "https://bandcamp.com/example",
    } as PlatformMetadata;

    expect(getCurrentTrackIndex(metadata, "https://radio.example/2.mp3")).toBe(
      1
    );
  });
});
