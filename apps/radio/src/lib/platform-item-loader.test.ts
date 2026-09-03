import { describe, expect, mock, test } from "bun:test";
import type { YouTubeClient } from "@avoid.quest/platforms/youtube";
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
      resolveStaticAudio: mock(() =>
        Promise.reject(new Error("static audio must remain unused"))
      ),
    });

    await expect(
      load("https://youtube.com/watch?v=abcdefghijk")
    ).resolves.toMatchObject({
      success: true,
      radio: {
        name: "Browser Track",
        streamUrl: "https://media.example/audio.webm",
        platformMetadata: { platform: "youtube", videoId: "abcdefghijk" },
      },
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
      resolveStaticAudio: mock(() =>
        Promise.reject(new Error("static audio must remain unused"))
      ),
    });

    await expect(load(fixture.url)).resolves.toMatchObject({
      success: true,
      radio: {
        name: fixture.name,
        streamUrl: "https://media.example/track.mp3",
      },
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
        format: "progressive" as const,
        streamUrl: "https://audio.example/mix.ogg",
      })
    );
    const load = createPlatformItemLoader({
      getYouTubeClient: () => {
        throw new Error("YouTube client must remain unused");
      },
      resolvePlatformItem,
      resolveStaticAudio,
    });

    await expect(load("https://audio.example/mix.ogg")).resolves.toMatchObject({
      success: true,
      radio: {
        name: "mix",
        streamUrl: "https://audio.example/mix.ogg",
        streamFormat: "progressive",
        platformMetadata: { platform: "static-audio" },
      },
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
      resolveStaticAudio: mock(() =>
        Promise.reject(new Error("static audio must remain unused"))
      ),
    });

    await expect(load(url)).resolves.toMatchObject({
      success: true,
      radio: {
        streamFormat: "hls",
        streamUrl: "https://media.example/signed-stream",
      },
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
      resolveStaticAudio: mock(() =>
        Promise.reject(new Error("static audio must remain unused"))
      ),
    });

    await expect(load(url)).resolves.toMatchObject({
      success: true,
      radio: { streamFormat: "hls", streamUrl },
    });
  });
});
