import { describe, expect, test } from "bun:test";
import type { Platform, PlatformMetadata } from "@/lib/platform-types";
import {
  calculateHasTracklist,
  getChangeSourceSearchPlatform,
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
        ["mixcloud", "pending-external"],
        ["soundcloud", "pending-external"],
        ["youtube", "pending-external"],
        ["radiogarden", "pending-external"],
        ["external", "pending-external"],
      ];

    for (const [platform, expected] of cases) {
      expect(resolveDeckPanelContentKind(true, platform)).toBe(expected);
    }
  });

  test("keeps Spotify's library tile on tab sharing: it has no search", () => {
    expect(resolveDeckPanelContentKind(false, "spotify")).toBe(
      "pending-browser"
    );
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

  test("shows Bandcamp artist and SoundCloud user tracklists", () => {
    const tracks = [
      { name: "One", streamUrl: "https://audio.example/one.mp3" },
    ];
    expect(
      calculateHasTracklist({
        itemType: "artist",
        platform: "bandcamp",
        tracks,
        url: "https://artist.bandcamp.com",
      } as PlatformMetadata)
    ).toBe(true);
    expect(
      calculateHasTracklist({
        itemType: "user",
        platform: "soundcloud",
        tracks,
        url: "https://soundcloud.com/user",
      } as PlatformMetadata)
    ).toBe(true);
    expect(
      calculateHasTracklist({
        itemType: "track",
        platform: "soundcloud",
        tracks,
        url: "https://soundcloud.com/user/track",
      } as PlatformMetadata)
    ).toBe(false);
  });

  test("shows Spotify albums and playlists as tracklists", () => {
    const tracks = [
      {
        artist: "Daft Punk",
        name: "One More Time",
        spotifyId: "0DiWol3AO6WpXZgp0goxAV",
        streamUrl: "spotify:track:0DiWol3AO6WpXZgp0goxAV",
        url: "https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV",
      },
    ];
    expect(
      calculateHasTracklist({
        itemType: "album",
        platform: "spotify",
        spotifyId: "2noRn2Aes5aoNVsU6iWThc",
        tracks,
        url: "https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc",
      })
    ).toBe(true);
    expect(
      calculateHasTracklist({
        itemType: "show",
        platform: "mixcloud",
        url: "https://www.mixcloud.com/user/show/",
      })
    ).toBe(false);
  });

  test("changes a Mixcloud show in Mixcloud, a Spotify item in every search", () => {
    expect(
      getChangeSourceSearchPlatform({
        itemType: "show",
        platform: "mixcloud",
        url: "https://www.mixcloud.com/user/show/",
      })
    ).toBe("mixcloud");
    expect(
      getChangeSourceSearchPlatform({
        itemType: "track",
        platform: "spotify",
        spotifyId: "2Foc5Q5nqNiosCNqttzHof",
        url: "https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof",
      })
    ).toBe("all");
  });

  test("opens the Stations picker, not a track search, to change a station", () => {
    expect(
      getChangeSourceSearchPlatform({
        itemType: "station",
        platform: "radio-browser",
        url: "https://radio.example/fip",
      } as PlatformMetadata)
    ).toBeNull();
    expect(
      getChangeSourceSearchPlatform({
        itemType: "channel",
        platform: "radiogarden",
        url: "https://radio.garden/listen/fip",
      } as PlatformMetadata)
    ).toBeNull();
    expect(getChangeSourceSearchPlatform(undefined)).toBeNull();
    expect(
      getChangeSourceSearchPlatform({
        itemType: "track",
        platform: "soundcloud",
        url: "https://soundcloud.com/user/track",
      } as PlatformMetadata)
    ).toBe("soundcloud");
  });
});
