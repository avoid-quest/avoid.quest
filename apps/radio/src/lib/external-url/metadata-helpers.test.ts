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
      ["spotify", "album"],
      ["spotify", "playlist"],
      ["static-audio", "playlist"],
    ]) {
      expect(isCollectionItem(platform, itemType)).toBeTrue();
    }
    for (const [platform, itemType] of [
      ["bandcamp", "track"],
      ["soundcloud", "track"],
      ["youtube", "video"],
      ["spotify", "track"],
      ["mixcloud", "show"],
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

  test("finds an unmatched Spotify track by its placeholder", () => {
    const metadata = {
      itemType: "playlist",
      platform: "spotify",
      spotifyId: "432nsnOM9L55tkiOFnHbI2",
      tracks: [
        {
          artist: "A",
          name: "One",
          spotifyId: "4Z1olDl8aym5xZYZAat672",
          streamUrl: "https://media.example/1.webm",
          url: "https://open.spotify.com/track/4Z1olDl8aym5xZYZAat672",
        },
        {
          artist: "B",
          name: "Two",
          spotifyId: "5eXyjGDzy8wrEn1pzu13uM",
          streamUrl: "spotify:track:5eXyjGDzy8wrEn1pzu13uM",
          url: "https://open.spotify.com/track/5eXyjGDzy8wrEn1pzu13uM",
        },
      ],
      url: "https://open.spotify.com/playlist/432nsnOM9L55tkiOFnHbI2",
    } as PlatformMetadata;

    expect(
      getCurrentTrackIndex(metadata, "spotify:track:5eXyjGDzy8wrEn1pzu13uM")
    ).toBe(1);
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
