import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { parseSpotifyEmbedPage } from "./metadata";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

const GET_LUCKY = { id: "2Foc5Q5nqNiosCNqttzHof", type: "track" } as const;
const DISCOVERY = { id: "2noRn2Aes5aoNVsU6iWThc", type: "album" } as const;
const SPRING = { id: "432nsnOM9L55tkiOFnHbI2", type: "playlist" } as const;

describe("parseSpotifyEmbedPage", () => {
  test("parses a track with every credited artist", () => {
    expect(
      parseSpotifyEmbedPage(GET_LUCKY, fixture("embed-track-get-lucky.html"))
    ).toEqual({
      metadata: {
        artist: "Daft Punk, Pharrell Williams, Nile Rodgers",
        artists: ["Daft Punk", "Pharrell Williams", "Nile Rodgers"],
        artwork:
          "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b27319a88dd5c7118e87d7b1619e",
        duration: 247.632,
        itemType: "track",
        name: "Get Lucky (Radio Edit) [feat. Pharrell Williams and Nile Rodgers]",
        platform: "spotify",
        spotifyId: "2Foc5Q5nqNiosCNqttzHof",
        url: "https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof",
      },
      success: true,
    });
  });

  test("parses an album into unmatched tracks with album artwork", () => {
    const result = parseSpotifyEmbedPage(
      DISCOVERY,
      fixture("embed-album-discovery.html")
    );
    if (!result.success) {
      throw new Error(result.error);
    }
    const { tracks, ...album } = result.metadata;
    const artwork =
      "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b2731e81bff9807a9e629fce5ade";
    expect(album).toEqual({
      album: "Discovery",
      artist: "Daft Punk",
      artwork,
      duration: 1060.689,
      itemType: "album",
      name: "Discovery",
      platform: "spotify",
      spotifyId: "2noRn2Aes5aoNVsU6iWThc",
      trackCount: 4,
      url: "https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc",
    });
    expect(tracks?.[0]).toEqual({
      album: "Discovery",
      artist: "Daft Punk",
      duration: 320.357,
      name: "One More Time",
      spotifyId: "0DiWol3AO6WpXZgp0goxAV",
      streamUrl: "spotify:track:0DiWol3AO6WpXZgp0goxAV",
      thumbnail: artwork,
      url: "https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV",
    });
    expect(tracks?.map((track) => track.name)).toEqual([
      "One More Time",
      "Aerodynamic",
      "Digital Love",
      "Harder, Better, Faster, Stronger",
    ]);
  });

  test("parses a playlist with per-track artists and no album", () => {
    const result = parseSpotifyEmbedPage(
      SPRING,
      fixture("embed-playlist-spring-24.html")
    );
    if (!result.success) {
      throw new Error(result.error);
    }
    expect(result.metadata.name).toBe("Spring ‘24");
    expect(result.metadata.artist).toBe("muan");
    expect(result.metadata.album).toBeUndefined();
    expect(result.metadata.artwork).toStartWith("https://image-cdn-");
    expect(
      result.metadata.tracks?.map(({ artist, name, album, thumbnail }) => ({
        album,
        artist,
        name,
        thumbnail,
      }))
    ).toEqual([
      {
        album: undefined,
        artist: "Rahill",
        name: "Tell Me",
        thumbnail: undefined,
      },
      {
        album: undefined,
        artist: "Leonard Cohen",
        name: "You Want It Darker",
        thumbnail: undefined,
      },
      {
        album: undefined,
        artist: "Leonard Cohen",
        name: "You Got Me Singing",
        thumbnail: undefined,
      },
    ]);
  });

  test("reports a missing item", () => {
    expect(
      parseSpotifyEmbedPage(
        { id: "0000000000000000000000", type: "track" },
        fixture("embed-not-found.html")
      )
    ).toEqual({ error: "Spotify track not found", success: false });
  });

  test("rejects pages that are not the requested item", () => {
    expect(
      parseSpotifyEmbedPage(DISCOVERY, fixture("embed-track-get-lucky.html"))
    ).toEqual({ error: "Unexpected Spotify embed page", success: false });
    expect(parseSpotifyEmbedPage(GET_LUCKY, "<html></html>")).toEqual({
      error: "Unexpected Spotify embed page",
      success: false,
    });
    expect(
      parseSpotifyEmbedPage(
        GET_LUCKY,
        '<script id="__NEXT_DATA__" type="application/json">{not json</script>'
      )
    ).toEqual({ error: "Unexpected Spotify embed page", success: false });
  });

  test("reports a collection without tracks", () => {
    const data = JSON.parse(
      load(fixture("embed-album-discovery.html"))("#__NEXT_DATA__").text()
    );
    data.props.pageProps.state.data.entity.trackList = [];
    const empty = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
    expect(parseSpotifyEmbedPage(DISCOVERY, empty)).toEqual({
      error: "This Spotify album has no tracks",
      success: false,
    });
  });
});
