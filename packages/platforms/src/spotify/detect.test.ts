import { describe, expect, test } from "bun:test";
import { detectPlatformFromUrl } from "../detect";
import { normalizePlayablePlatformUrl } from "../playable";
import {
  detectSpotifyItemType,
  getSpotifyTrackPlaceholder,
  isSpotifyUrl,
  needsSpotifyResolution,
  normalizeSpotifyUrl,
  parseSpotifyRef,
  parseSpotifyTrackPlaceholder,
} from "./detect";

const TRACK_ID = "4cOdK2wGLETKBW3PvgPWqT";
const ALBUM_ID = "2noRn2Aes5aoNVsU6iWThc";
const PLAYLIST_ID = "37i9dQZF1DXcBWIGoYBM5M";

describe("parseSpotifyRef", () => {
  test.each([
    [`https://open.spotify.com/track/${TRACK_ID}`, "track", TRACK_ID],
    [`https://open.spotify.com/track/${TRACK_ID}?si=abc123`, "track", TRACK_ID],
    [`https://OPEN.SPOTIFY.COM./track/${TRACK_ID}/`, "track", TRACK_ID],
    [`https://open.spotify.com/intl-it/track/${TRACK_ID}`, "track", TRACK_ID],
    [
      `https://open.spotify.com/intl-pt-BR/album/${ALBUM_ID}`,
      "album",
      ALBUM_ID,
    ],
    [`https://open.spotify.com/embed/album/${ALBUM_ID}`, "album", ALBUM_ID],
    [`https://play.spotify.com/album/${ALBUM_ID}`, "album", ALBUM_ID],
    [
      `https://open.spotify.com/playlist/${PLAYLIST_ID}?si=x&pi=y`,
      "playlist",
      PLAYLIST_ID,
    ],
    [
      `https://open.spotify.com/user/spotify/playlist/${PLAYLIST_ID}`,
      "playlist",
      PLAYLIST_ID,
    ],
    [`spotify:track:${TRACK_ID}`, "track", TRACK_ID],
    [`  spotify:album:${ALBUM_ID}  `, "album", ALBUM_ID],
    [`spotify:user:spotify:playlist:${PLAYLIST_ID}`, "playlist", PLAYLIST_ID],
  ] as const)("parses %s", (url, type, id) => {
    expect(parseSpotifyRef(url)).toEqual({ id, type });
  });

  test.each([
    "",
    "https://open.spotify.com/",
    `https://open.spotify.com/artist/${TRACK_ID}`,
    `https://open.spotify.com/episode/${TRACK_ID}`,
    `https://open.spotify.com/show/${TRACK_ID}`,
    "https://open.spotify.com/track/tooShort",
    `https://open.spotify.com/track/${TRACK_ID}/extra`,
    `https://open.spotify.com.evil.example/track/${TRACK_ID}`,
    `https://evil.example/open.spotify.com/track/${TRACK_ID}`,
    `https://developer.spotify.com/track/${TRACK_ID}`,
    `ftp://open.spotify.com/track/${TRACK_ID}`,
    "https://spotify.link/6tpneu0iVIb",
    `spotify:artist:${TRACK_ID}`,
    `spotify:track:${TRACK_ID}:extra`,
    "spotify:track:not-an-id",
  ])("rejects %s", (url) => {
    expect(parseSpotifyRef(url)).toBeNull();
  });
});

describe("Spotify URL helpers", () => {
  test("isSpotifyUrl covers web links, share links and URIs only", () => {
    expect(isSpotifyUrl(`https://open.spotify.com/track/${TRACK_ID}`)).toBe(
      true
    );
    expect(isSpotifyUrl("https://spotify.link/6tpneu0iVIb")).toBe(true);
    expect(isSpotifyUrl(`spotify:track:${TRACK_ID}`)).toBe(true);
    expect(isSpotifyUrl("https://open.spotify.com.evil.example/track/x")).toBe(
      false
    );
    expect(isSpotifyUrl("https://notspotify.com/track/x")).toBe(false);
    expect(isSpotifyUrl("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
  });

  test("needsSpotifyResolution only matches share-link codes", () => {
    expect(needsSpotifyResolution("https://spotify.link/6tpneu0iVIb")).toBe(
      true
    );
    expect(
      needsSpotifyResolution("https://spotify.app.link/6tpneu0iVIb/")
    ).toBe(true);
    expect(needsSpotifyResolution("https://spotify.link/a/b")).toBe(false);
    expect(
      needsSpotifyResolution(`https://open.spotify.com/track/${TRACK_ID}`)
    ).toBe(false);
    expect(needsSpotifyResolution("https://spotify.link.evil/abc")).toBe(false);
  });

  test("normalizeSpotifyUrl canonicalizes links and URIs", () => {
    expect(
      normalizeSpotifyUrl(
        `https://open.spotify.com/intl-de/track/${TRACK_ID}?si=abc`
      )
    ).toBe(`https://open.spotify.com/track/${TRACK_ID}`);
    expect(normalizeSpotifyUrl(`spotify:album:${ALBUM_ID}`)).toBe(
      `https://open.spotify.com/album/${ALBUM_ID}`
    );
    expect(normalizeSpotifyUrl("https://example.com/a")).toBe(
      "https://example.com/a"
    );
  });

  test("detectSpotifyItemType", () => {
    expect(detectSpotifyItemType(`spotify:playlist:${PLAYLIST_ID}`)).toBe(
      "playlist"
    );
    expect(detectSpotifyItemType("https://open.spotify.com/")).toBeNull();
  });

  test("track placeholders round-trip and reject other strings", () => {
    const placeholder = getSpotifyTrackPlaceholder(TRACK_ID);
    expect(placeholder).toBe(`spotify:track:${TRACK_ID}`);
    expect(parseSpotifyTrackPlaceholder(placeholder)).toBe(TRACK_ID);
    expect(parseSpotifyTrackPlaceholder(`yt:${TRACK_ID}`)).toBeNull();
    expect(
      parseSpotifyTrackPlaceholder(`https://open.spotify.com/track/${TRACK_ID}`)
    ).toBeNull();
  });
});

describe("Spotify platform registration", () => {
  test("detectPlatformFromUrl detects Spotify", () => {
    expect(
      detectPlatformFromUrl(`https://open.spotify.com/album/${ALBUM_ID}`)
    ).toBe("spotify");
    expect(detectPlatformFromUrl(`spotify:track:${TRACK_ID}`)).toBe("spotify");
  });

  test("normalizePlayablePlatformUrl resolves share links and canonicalizes", async () => {
    const resolved: string[] = [];
    await expect(
      normalizePlayablePlatformUrl(" https://spotify.link/6tpneu0iVIb ", {
        resolveSpotifyShortLink: (url) => {
          resolved.push(url);
          return Promise.resolve(
            `https://open.spotify.com/intl-it/playlist/${PLAYLIST_ID}?si=x`
          );
        },
      })
    ).resolves.toBe(`https://open.spotify.com/playlist/${PLAYLIST_ID}`);
    expect(resolved).toEqual(["https://spotify.link/6tpneu0iVIb"]);

    await expect(
      normalizePlayablePlatformUrl(`spotify:track:${TRACK_ID}`)
    ).resolves.toBe(`https://open.spotify.com/track/${TRACK_ID}`);
  });
});
