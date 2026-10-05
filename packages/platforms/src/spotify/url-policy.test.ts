import { describe, expect, test } from "bun:test";
import {
  isSpotifyHostname,
  isSpotifyHttpUrl,
  isSpotifyPageHostname,
  isSpotifyShortLinkHostname,
} from "./url-policy";

describe("Spotify hostnames", () => {
  test("page hosts", () => {
    expect(isSpotifyPageHostname("open.spotify.com")).toBe(true);
    expect(isSpotifyPageHostname("OPEN.SPOTIFY.COM.")).toBe(true);
    expect(isSpotifyPageHostname("play.spotify.com")).toBe(true);
    expect(isSpotifyPageHostname("spotify.com")).toBe(false);
    expect(isSpotifyPageHostname("open.spotify.com.evil.example")).toBe(false);
  });

  test("short-link hosts", () => {
    expect(isSpotifyShortLinkHostname("spotify.link")).toBe(true);
    expect(isSpotifyShortLinkHostname("spotify.app.link")).toBe(true);
    expect(isSpotifyShortLinkHostname("evil.app.link")).toBe(false);
    expect(isSpotifyShortLinkHostname("spotify.link.evil")).toBe(false);
  });

  test("any Spotify host", () => {
    expect(isSpotifyHostname("spotify.com")).toBe(true);
    expect(isSpotifyHostname("support.spotify.com")).toBe(true);
    expect(isSpotifyHostname("spotify.link")).toBe(true);
    expect(isSpotifyHostname("notspotify.com")).toBe(false);
    expect(isSpotifyHostname("spotify.com.evil.example")).toBe(false);
  });

  test("isSpotifyHttpUrl requires HTTP(S)", () => {
    expect(isSpotifyHttpUrl("https://open.spotify.com/track/x")).toBe(true);
    expect(isSpotifyHttpUrl("ftp://open.spotify.com/track/x")).toBe(false);
    expect(isSpotifyHttpUrl("spotify:track:x")).toBe(false);
    expect(isSpotifyHttpUrl("not a url")).toBe(false);
  });
});
