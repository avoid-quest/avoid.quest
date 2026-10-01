import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createPlayablePlatformResolver, toPlayableSources } from "../playable";
import youtubeSearch from "./fixtures/youtube-search.json";
import {
  getSpotifyItem,
  getSpotifyMetadata,
  resolveSpotifyShortLink,
  resolveSpotifyTrackStream,
  SPOTIFY_NO_MATCH_ERROR,
} from "./index";
import type { SpotifyYouTubeCandidate, SpotifyYouTubeSource } from "./types";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

const search = youtubeSearch as Record<string, SpotifyYouTubeCandidate[]>;
function results(key: string): SpotifyYouTubeCandidate[] {
  const found = search[key];
  if (!found) {
    throw new Error(`Missing fixture ${key}`);
  }
  return found;
}

const PAGES: Record<string, string> = {
  "https://open.spotify.com/embed/album/2noRn2Aes5aoNVsU6iWThc":
    "embed-album-discovery.html",
  "https://open.spotify.com/embed/playlist/432nsnOM9L55tkiOFnHbI2":
    "embed-playlist-spring-24.html",
  "https://open.spotify.com/embed/track/2Foc5Q5nqNiosCNqttzHof":
    "embed-track-get-lucky.html",
  "https://open.spotify.com/embed/track/0000000000000000000000":
    "embed-not-found.html",
  "https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof":
    "track-page-get-lucky.html",
};

function spotifyFetch(requests: string[] = []): typeof fetch {
  return mock((input: string | URL | Request) => {
    const url = input.toString();
    requests.push(url);
    const page = PAGES[url];
    return Promise.resolve(
      page
        ? new Response(fixture(page), {
            headers: { "content-type": "text/html" },
          })
        : new Response("missing", { status: 404 })
    );
  }) as unknown as typeof fetch;
}

type FakeYouTube = SpotifyYouTubeSource & {
  searches: string[];
  streams: string[];
};

function fakeYouTube({
  byQuery,
  failingStreams = [],
}: {
  byQuery: Record<string, SpotifyYouTubeCandidate[]>;
  failingStreams?: string[];
}): FakeYouTube {
  const searches: string[] = [];
  const streams: string[] = [];
  return {
    resolveStream: (videoId) => {
      streams.push(videoId);
      return failingStreams.includes(videoId)
        ? Promise.reject(new Error("Every configured YouTube provider failed"))
        : Promise.resolve(`https://media.example/${videoId}.webm`);
    },
    search: (query, filter) => {
      searches.push(`${filter}: ${query}`);
      return Promise.resolve(byQuery[`${filter}: ${query}`] ?? []);
    },
    searches,
    streams,
  };
}

const GET_LUCKY_SONGS = results(
  "piped-songs: Daft Punk Get Lucky (Radio Edit)"
);
const RAHILL_SONGS = results("piped-songs: Rahill Tell Me");
const RAHILL_VIDEOS = results("invidious: Rahill Tell Me");

describe("getSpotifyMetadata", () => {
  test("leaves a track's album unknown when the embed does not provide it", async () => {
    const requests: string[] = [];
    const result = await getSpotifyMetadata(
      "https://open.spotify.com/intl-it/track/2Foc5Q5nqNiosCNqttzHof?si=abc",
      { fetchImpl: spotifyFetch(requests) }
    );
    if (!result.success) {
      throw new Error(result.error);
    }
    expect(result.metadata.album).toBeUndefined();
    expect(result).toMatchObject({
      metadata: {
        artist: "Daft Punk, Pharrell Williams, Nile Rodgers",
        url: "https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof",
      },
      success: true,
    });
    expect(requests.toSorted()).toEqual([
      "https://open.spotify.com/embed/track/2Foc5Q5nqNiosCNqttzHof",
    ]);
  });

  test("rejects unsupported links without fetching", async () => {
    const requests: string[] = [];
    await expect(
      getSpotifyMetadata(
        "https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt",
        { fetchImpl: spotifyFetch(requests) }
      )
    ).resolves.toEqual({
      error:
        "Unsupported Spotify URL: only track, album and playlist links can be played",
      success: false,
    });
    expect(requests).toEqual([]);
  });

  test("reports missing items and HTTP failures", async () => {
    await expect(
      getSpotifyMetadata("spotify:track:0000000000000000000000", {
        fetchImpl: spotifyFetch(),
      })
    ).resolves.toEqual({ error: "Spotify track not found", success: false });
    await expect(
      getSpotifyMetadata("spotify:album:1111111111111111111111", {
        fetchImpl: spotifyFetch(),
      })
    ).resolves.toEqual({
      error: "Failed to get Spotify item: Spotify returned HTTP 404",
      success: false,
    });
  });
});

describe("resolveSpotifyTrackStream", () => {
  const tellMe = { artists: ["Rahill"], duration: 161.36, name: "Tell Me" };

  test("falls back to videos when the matched song will not stream", async () => {
    const youtube = fakeYouTube({
      byQuery: {
        "songs: Rahill Tell Me": RAHILL_SONGS,
        "videos: Rahill Tell Me": RAHILL_VIDEOS,
      },
      failingStreams: ["10OaW3O429k"],
    });
    const result = await resolveSpotifyTrackStream(tellMe, { youtube });
    expect(result).toMatchObject({
      match: { videoId: "st1qchy2tyc" },
      streamUrl: "https://media.example/st1qchy2tyc.webm",
      success: true,
    });
    expect(youtube.streams).toEqual(["10OaW3O429k", "st1qchy2tyc"]);
  });

  test("tries video results before leftover unstreamable songs", async () => {
    const songs = [
      "song0000001",
      "song0000002",
      "song0000003",
      "song0000004",
    ].map((videoId) => ({
      author: "Rahill - Topic",
      duration: tellMe.duration,
      title: tellMe.name,
      videoId,
    }));
    const youtube = fakeYouTube({
      byQuery: {
        "songs: Rahill Tell Me": songs,
        "videos: Rahill Tell Me": [
          {
            author: "Rahill",
            duration: tellMe.duration,
            title: "Rahill - Tell Me (Official Video)",
            videoId: "video000001",
          },
        ],
      },
      failingStreams: songs.map((song) => song.videoId),
    });
    await expect(
      resolveSpotifyTrackStream(tellMe, { youtube })
    ).resolves.toMatchObject({
      match: { videoId: "video000001" },
      success: true,
    });
    expect(youtube.streams).toEqual([
      "song0000001",
      "song0000002",
      "video000001",
    ]);
  });

  test("returns the no-match error when nothing is close enough", async () => {
    const youtube = fakeYouTube({
      byQuery: {
        "songs: Leonard Cohen You Want It Darker": RAHILL_SONGS,
      },
    });
    await expect(
      resolveSpotifyTrackStream(
        {
          artists: ["Leonard Cohen"],
          duration: 284.363,
          name: "You Want It Darker",
        },
        { youtube }
      )
    ).resolves.toEqual({ error: SPOTIFY_NO_MATCH_ERROR, success: false });
    expect(youtube.searches).toEqual([
      "songs: Leonard Cohen You Want It Darker",
      "videos: Leonard Cohen You Want It Darker",
    ]);
    expect(youtube.streams).toEqual([]);
  });

  test("reports search and stream failures", async () => {
    await expect(
      resolveSpotifyTrackStream(tellMe, {
        youtube: {
          resolveStream: () => Promise.resolve(""),
          search: () => Promise.reject(new Error("HTTP 503")),
        },
      })
    ).resolves.toEqual({
      error: "YouTube search failed: HTTP 503",
      success: false,
    });

    const youtube = fakeYouTube({
      byQuery: { "songs: Rahill Tell Me": RAHILL_SONGS },
      failingStreams: ["10OaW3O429k"],
    });
    await expect(
      resolveSpotifyTrackStream(tellMe, { youtube })
    ).resolves.toEqual({
      error:
        "Matched YouTube video could not be streamed: Every configured YouTube provider failed",
      success: false,
    });
  });
});

describe("getSpotifyItem", () => {
  test("matches a track and keeps the matched video id", async () => {
    const youtube = fakeYouTube({
      byQuery: {
        "songs: Daft Punk Get Lucky (Radio Edit)": GET_LUCKY_SONGS,
      },
    });
    const result = await getSpotifyItem(
      "spotify:track:2Foc5Q5nqNiosCNqttzHof",
      { fetchImpl: spotifyFetch(), youtube }
    );
    if (!result.success) {
      throw new Error(result.error);
    }
    expect(result.streamUrl).toBe("https://media.example/Rgrt_8mXrK8.webm");
    expect(result.metadata).toMatchObject({
      name: "Get Lucky (Radio Edit) [feat. Pharrell Williams and Nile Rodgers]",
      platform: "spotify",
      streamUrl: "https://media.example/Rgrt_8mXrK8.webm",
      youtubeMatch: { duration: 249, videoId: "Rgrt_8mXrK8" },
      youtubeVideoId: "Rgrt_8mXrK8",
    });
  });

  test("matches only the first playable track of a playlist", async () => {
    const youtube = fakeYouTube({
      byQuery: {
        "songs: Leonard Cohen You Want It Darker": [
          {
            author: "Leonard Cohen",
            duration: 285,
            title: "You Want It Darker",
            videoId: "f7j4s2FURH8",
          },
        ],
      },
    });
    const result = await getSpotifyItem(
      "https://open.spotify.com/playlist/432nsnOM9L55tkiOFnHbI2",
      { fetchImpl: spotifyFetch(), youtube }
    );
    if (!result.success) {
      throw new Error(result.error);
    }
    const tracks = result.metadata.tracks ?? [];
    // "Tell Me" has no candidates here, so the second track plays first.
    expect(tracks.map((track) => track.streamUrl)).toEqual([
      "spotify:track:4Z1olDl8aym5xZYZAat672",
      "https://media.example/f7j4s2FURH8.webm",
      "spotify:track:5eXyjGDzy8wrEn1pzu13uM",
    ]);
    expect(tracks[1]?.youtubeVideoId).toBe("f7j4s2FURH8");
    expect(result.streamUrl).toBe("https://media.example/f7j4s2FURH8.webm");

    expect(
      toPlayableSources({
        metadata: result.metadata,
        normalizedUrl: result.metadata.url,
        platform: "spotify",
        streamUrl: result.streamUrl,
      }).map(({ artist, streamUrl, title }) => ({ artist, streamUrl, title }))
    ).toEqual([
      {
        artist: "Rahill",
        streamUrl: "spotify:track:4Z1olDl8aym5xZYZAat672",
        title: "Tell Me",
      },
      {
        artist: "Leonard Cohen",
        streamUrl: "https://media.example/f7j4s2FURH8.webm",
        title: "You Want It Darker",
      },
      {
        artist: "Leonard Cohen",
        streamUrl: "spotify:track:5eXyjGDzy8wrEn1pzu13uM",
        title: "You Got Me Singing",
      },
    ]);
  });

  test("fails a collection when none of the first tracks match", async () => {
    const youtube = fakeYouTube({ byQuery: {} });
    await expect(
      getSpotifyItem("spotify:album:2noRn2Aes5aoNVsU6iWThc", {
        fetchImpl: spotifyFetch(),
        firstTrackAttempts: 2,
        youtube,
      })
    ).resolves.toEqual({
      error: `No playable track found in this Spotify album: ${SPOTIFY_NO_MATCH_ERROR}`,
      success: false,
    });
    expect(youtube.searches).toHaveLength(4);
  });
});

describe("resolveSpotifyShortLink", () => {
  test("follows a redirect straight to open.spotify.com", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(
        Response.redirect(
          "https://open.spotify.com/playlist/432nsnOM9L55tkiOFnHbI2?si=s1MR&pi=a",
          307
        )
      )
    ) as unknown as typeof fetch;
    await expect(
      resolveSpotifyShortLink("https://spotify.app.link/6tpneu0iVIb", {
        fetchImpl,
      })
    ).resolves.toBe("https://open.spotify.com/playlist/432nsnOM9L55tkiOFnHbI2");
  });

  test("reads the target from the app.link landing page", async () => {
    const requests: string[] = [];
    const fetchImpl = mock((input: string | URL | Request) => {
      const url = input.toString();
      requests.push(url);
      if (url === "https://spotify.link/6tpneu0iVIb") {
        return Promise.resolve(
          Response.redirect(
            "https://spotify.app.link/6tpneu0iVIb?_p=c81529c79e1c62f1fc1f8bf9",
            307
          )
        );
      }
      return Promise.resolve(
        new Response(
          '<a class="secondary-action" href="https://open.spotify.com/playlist/432nsnOM9L55tkiOFnHbI2?si=s1MR&amp;pi=a">Open</a>'
        )
      );
    }) as unknown as typeof fetch;
    await expect(
      resolveSpotifyShortLink("https://spotify.link/6tpneu0iVIb", {
        fetchImpl,
      })
    ).resolves.toBe("https://open.spotify.com/playlist/432nsnOM9L55tkiOFnHbI2");
    expect(requests).toHaveLength(2);
  });

  test.each([
    ["an oversized chunk", ["x".repeat(256 * 1024)]],
    ["multibyte chunks", ["é".repeat(128 * 1024), ""]],
  ])("stops reading at the byte limit for %s", async (_name, prefixes) => {
    const target = "https://open.spotify.com/playlist/432nsnOM9L55tkiOFnHbI2";
    const chunks = [...prefixes];
    chunks[chunks.length - 1] += target;
    chunks.push("x".repeat(256 * 1024));
    const cancel = mock(() => undefined);
    const response = new Response(
      new ReadableStream({
        cancel,
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
        },
      })
    );
    const fetchImpl = mock(() =>
      Promise.resolve(response)
    ) as unknown as typeof fetch;
    await expect(
      resolveSpotifyShortLink("https://spotify.link/abc", { fetchImpl })
    ).rejects.toThrow(
      "Spotify short link does not point to a track, album or playlist"
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test("reports an empty landing page", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(new Response(null))
    ) as unknown as typeof fetch;
    await expect(
      resolveSpotifyShortLink("https://spotify.link/abc", { fetchImpl })
    ).rejects.toThrow(
      "Spotify short link does not point to a track, album or playlist"
    );
  });

  test("rejects links that leave Spotify or land on a non-item page", async () => {
    const redirectTo = (location: string) =>
      mock(() =>
        Promise.resolve(Response.redirect(location, 302))
      ) as unknown as typeof fetch;
    const message =
      "Spotify short link does not point to a track, album or playlist";
    await expect(
      resolveSpotifyShortLink("https://spotify.link/abc", {
        fetchImpl: redirectTo("https://evil.example/track"),
      })
    ).rejects.toThrow(message);
    await expect(
      resolveSpotifyShortLink("https://spotify.link/abc", {
        fetchImpl: redirectTo("https://open.spotify.com/"),
      })
    ).rejects.toThrow(message);
    await expect(
      resolveSpotifyShortLink("https://open.spotify.com/track/x")
    ).rejects.toThrow("Invalid Spotify short link");
  });
});

describe("playable resolver", () => {
  test("leaves Spotify unsupported until a YouTube source is configured", async () => {
    const resolver = createPlayablePlatformResolver();
    await expect(
      resolver.resolveItem("https://spotify.link/6tpneu0iVIb")
    ).resolves.toEqual({
      error: { code: "unsupported-url", message: "Unsupported URL" },
      success: false,
    });
  });

  test("reports Spotify failures as provider errors", async () => {
    const resolver = createPlayablePlatformResolver({
      spotify: { youtube: () => fakeYouTube({ byQuery: {} }) },
    });
    const result = await resolver.resolveNormalizedItem(
      "https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt"
    );
    expect(result).toEqual({
      error: {
        code: "provider-resolution-failed",
        message:
          "Unsupported Spotify URL: only track, album and playlist links can be played",
        platform: "spotify",
      },
      success: false,
    });
  });
});
