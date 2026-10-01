import { describe, expect, mock, test } from "bun:test";
import type { SpotifyMetadata } from "@avoid.quest/platforms/spotify";
import type { YouTubeClient } from "@avoid.quest/platforms/youtube";
import { resolveSpotifyItem as matchSpotifyItem } from "./platform-client";
import { createPlatformItemLoader } from "./platform-item-loader";

function youtubeClient(
  resolveItem: YouTubeClient["resolveItem"]
): YouTubeClient {
  return {
    providers: [],
    resolveItem,
    resolveStream: mock(() => Promise.reject(new Error("unused"))),
    search: mock(() => Promise.reject(new Error("unused"))),
  };
}

const unusedSpotify = () =>
  Promise.reject(new Error("Spotify must remain unused"));

describe("browser platform item loader", () => {
  test("resolves YouTube URLs in the browser without calling the app server", async () => {
    const resolvePlatformItem = mock(() => {
      throw new Error("Platform server must remain unused");
    });
    const load = createPlatformItemLoader({
      getYouTubeClient: () =>
        youtubeClient(
          mock(() =>
            Promise.resolve({
              metadata: {
                artist: "Browser Artist",
                itemType: "video" as const,
                name: "Browser Track",
                platform: "youtube" as const,
                url: "https://youtube.com/watch?v=abcdefghijk",
                videoId: "abcdefghijk",
              },
              streamUrl: "https://media.example/audio.webm",
              success: true as const,
            })
          )
        ),
      resolvePlatformItem,
      resolveSpotifyItem: unusedSpotify,
      resolveStaticAudio: mock(() =>
        Promise.reject(new Error("static audio must remain unused"))
      ),
    });

    await expect(
      load("https://youtube.com/watch?v=abcdefghijk")
    ).resolves.toMatchObject({
      radio: {
        name: "Browser Track",
        platformMetadata: { platform: "youtube", videoId: "abcdefghijk" },
        streamUrl: "https://media.example/audio.webm",
      },
      success: true,
    });
    expect(resolvePlatformItem).not.toHaveBeenCalled();
  });

  test("returns an actionable failure when YouTube client initialization fails", async () => {
    const load = createPlatformItemLoader({
      getYouTubeClient: () => {
        throw new Error("No public YouTube provider is available");
      },
      resolvePlatformItem: mock(() => {
        throw new Error("Platform server must remain unused");
      }),
      resolveSpotifyItem: unusedSpotify,
      resolveStaticAudio: mock(() =>
        Promise.reject(new Error("static audio must remain unused"))
      ),
    });

    await expect(load("https://youtu.be/abcdefghijk")).resolves.toEqual({
      code: "YOUTUBE_CLIENT_RESOLUTION_FAILED",
      error: "No public YouTube provider is available",
      success: false,
    });
  });

  test.each([
    {
      metadata: {
        artist: "Bandcamp Artist",
        itemType: "track" as const,
        name: "Bandcamp Track",
        platform: "bandcamp" as const,
        url: "https://artist.bandcamp.com/track/example",
      },
      name: "Bandcamp Track",
      platform: "bandcamp" as const,
      url: "https://artist.bandcamp.com/track/example",
    },
    {
      metadata: {
        artist: "Cloud Artist",
        itemType: "track" as const,
        name: "Cloud Track",
        platform: "soundcloud" as const,
        url: "https://soundcloud.com/artist/track",
      },
      name: "Cloud Track",
      platform: "soundcloud" as const,
      url: "https://soundcloud.com/artist/track",
    },
    {
      metadata: {
        artist: "NTS Radio",
        itemType: "show" as const,
        name: "Mixcloud Show",
        platform: "mixcloud" as const,
        url: "https://www.mixcloud.com/NTSRadio/show/",
      },
      name: "Mixcloud Show",
      platform: "mixcloud" as const,
      url: "https://www.mixcloud.com/NTSRadio/show/",
    },
    {
      metadata: {
        channelId: "station-id",
        itemType: "channel" as const,
        name: "Garden Station",
        platform: "radiogarden" as const,
        url: "https://radio.garden/listen/station/station-id",
      },
      name: "Garden Station",
      platform: "radiogarden" as const,
      url: "https://radio.garden/listen/station/station-id",
    },
  ])("resolves $platform URLs through the platform server", async (fixture) => {
    const getYouTubeClient = mock(() => {
      throw new Error("YouTube client must remain unused");
    });
    const resolvePlatformItem = mock(() =>
      Promise.resolve({
        metadata: fixture.metadata,
        streamUrl: "https://media.example/track.mp3",
      })
    );
    const load = createPlatformItemLoader({
      getYouTubeClient,
      resolvePlatformItem,
      resolveSpotifyItem: unusedSpotify,
      resolveStaticAudio: mock(() =>
        Promise.reject(new Error("static audio must remain unused"))
      ),
    });

    await expect(load(fixture.url)).resolves.toMatchObject({
      radio: {
        name: fixture.name,
        streamUrl: "https://media.example/track.mp3",
      },
      success: true,
    });
    expect(getYouTubeClient).not.toHaveBeenCalled();
    expect(resolvePlatformItem).toHaveBeenCalledWith(fixture.url);
  });

  test("resolves static audio in the browser without calling the app server", async () => {
    const resolvePlatformItem = mock(() => {
      throw new Error("static audio must not use the platform server");
    });
    const resolveStaticAudio = mock(() =>
      Promise.resolve({
        format: "progressive" as const,
        metadata: {
          displayName: "mix",
          duration: 0,
          fileName: "mix",
          fileSize: 0,
          isLocal: false,
          itemType: "track" as const,
          mimeType: "audio/ogg",
          platform: "static-audio" as const,
          streamUrl: "https://audio.example/mix.ogg",
          url: "https://audio.example/mix.ogg",
        },
        streamUrl: "https://audio.example/mix.ogg",
      })
    );
    const load = createPlatformItemLoader({
      getYouTubeClient: () => {
        throw new Error("YouTube client must remain unused");
      },
      resolvePlatformItem,
      resolveSpotifyItem: unusedSpotify,
      resolveStaticAudio,
    });

    await expect(load("https://audio.example/mix.ogg")).resolves.toMatchObject({
      radio: {
        name: "mix",
        platformMetadata: { platform: "static-audio" },
        streamFormat: "progressive",
        streamUrl: "https://audio.example/mix.ogg",
      },
      success: true,
    });
    expect(resolveStaticAudio).toHaveBeenCalledWith(
      "https://audio.example/mix.ogg"
    );
    expect(resolvePlatformItem).not.toHaveBeenCalled();
  });

  test("carries an extensionless HLS format into playback", async () => {
    const url = "https://soundcloud.com/artist/live-set";
    const load = createPlatformItemLoader({
      getYouTubeClient: () => {
        throw new Error("YouTube client must remain unused");
      },
      resolvePlatformItem: mock(() =>
        Promise.resolve({
          format: "hls" as const,
          metadata: {
            itemType: "track" as const,
            name: "Live set",
            platform: "soundcloud" as const,
            url,
          },
          streamUrl: "https://media.example/signed-stream",
        })
      ),
      resolveSpotifyItem: unusedSpotify,
      resolveStaticAudio: mock(() =>
        Promise.reject(new Error("static audio must remain unused"))
      ),
    });

    await expect(load(url)).resolves.toMatchObject({
      radio: {
        streamFormat: "hls",
        streamUrl: "https://media.example/signed-stream",
      },
      success: true,
    });
  });

  test("uses the selected nested-track format when the top-level format is omitted", async () => {
    const url = "https://soundcloud.com/artist/live-set";
    const streamUrl = "https://media.example/extensionless-live";
    const load = createPlatformItemLoader({
      getYouTubeClient: () => {
        throw new Error("YouTube client must remain unused");
      },
      resolvePlatformItem: mock(() =>
        Promise.resolve({
          metadata: {
            itemType: "playlist" as const,
            name: "Live set",
            platform: "soundcloud" as const,
            tracks: [
              {
                format: "hls" as const,
                name: "Live track",
                streamUrl,
              },
            ],
            url,
          },
          streamUrl,
        })
      ),
      resolveSpotifyItem: unusedSpotify,
      resolveStaticAudio: mock(() =>
        Promise.reject(new Error("static audio must remain unused"))
      ),
    });

    await expect(load(url)).resolves.toMatchObject({
      radio: { streamFormat: "hls", streamUrl },
      success: true,
    });
  });

  test("matches Spotify links in the browser after the server's metadata", async () => {
    const url = "https://open.spotify.com/track/2Foc5Q5nqNiosCNqttzHof";
    const resolveSpotifyItem = mock(() =>
      Promise.resolve({
        metadata: {
          artist: "Daft Punk",
          itemType: "track" as const,
          name: "Get Lucky",
          platform: "spotify" as const,
          spotifyId: "2Foc5Q5nqNiosCNqttzHof",
          url,
          youtubeVideoId: "Rgrt_8mXrK8",
        },
        streamUrl: "https://media.example/videoplayback?expire=1",
      })
    );
    const load = createPlatformItemLoader({
      getYouTubeClient: () => {
        throw new Error("YouTube links must remain unused");
      },
      resolvePlatformItem: mock(() => {
        throw new Error("Spotify must not use the platform resolver");
      }),
      resolveSpotifyItem,
      resolveStaticAudio: mock(() =>
        Promise.reject(new Error("static audio must remain unused"))
      ),
    });

    const pasted =
      "https://open.spotify.com/intl-de/track/2Foc5Q5nqNiosCNqttzHof?si=x";
    await expect(load(pasted)).resolves.toMatchObject({
      radio: {
        name: "Get Lucky",
        platformMetadata: {
          platform: "spotify",
          youtubeVideoId: "Rgrt_8mXrK8",
        },
        streamUrl: "https://media.example/videoplayback?expire=1",
      },
      success: true,
    });
    expect(resolveSpotifyItem).toHaveBeenCalledWith(pasted, {
      signal: undefined,
    });
  });

  test("stops matching a Spotify playlist once its load is aborted", async () => {
    const url = "https://open.spotify.com/playlist/432nsnOM9L55tkiOFnHbI2";
    const track = (spotifyId: string, name: string) => ({
      artist: "Rahill",
      duration: 160,
      name,
      spotifyId,
      streamUrl: `spotify:track:${spotifyId}`,
      url: `https://open.spotify.com/track/${spotifyId}`,
    });
    const metadata: SpotifyMetadata = {
      itemType: "playlist",
      platform: "spotify",
      spotifyId: "432nsnOM9L55tkiOFnHbI2",
      tracks: [
        track("4Z1olDl8aym5xZYZAat672", "Tell Me"),
        track("5eXyjGDzy8wrEn1pzu13uM", "Shake"),
        track("2Foc5Q5nqNiosCNqttzHof", "Swimming Pool"),
      ],
      url,
    };
    const controller = new AbortController();
    // The user cancels while the first track is being searched.
    const search = mock(() => {
      controller.abort();
      return Promise.resolve([]);
    });
    const load = createPlatformItemLoader({
      getYouTubeClient: () => {
        throw new Error("YouTube links must remain unused");
      },
      resolvePlatformItem: mock(() => {
        throw new Error("Spotify must not use the platform resolver");
      }),
      resolveSpotifyItem: (spotifyUrl, options) =>
        matchSpotifyItem(spotifyUrl, {
          ...options,
          loadMetadata: () => Promise.resolve(metadata),
          youtube: {
            resolveStream: () => Promise.reject(new Error("unused")),
            search,
          },
        }),
      resolveStaticAudio: mock(() =>
        Promise.reject(new Error("static audio must remain unused"))
      ),
    });

    await expect(
      load(url, { signal: controller.signal })
    ).resolves.toMatchObject({ success: false });
    expect(search).toHaveBeenCalledTimes(1);
  });
});
