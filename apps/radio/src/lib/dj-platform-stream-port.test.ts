import { describe, expect, mock, test } from "bun:test";
import type { YouTubeClient } from "@avoid.quest/platforms/youtube";
import type { Radio } from "@/lib/audio";
import { resolveDjPlatformStreamUrl } from "./dj-platform-stream-port";

const radio: Radio = {
  enabled: true,
  id: "youtube-test",
  name: "YouTube test",
  streamUrl: "yt:abcdefghijk",
};

function youtubeClient(
  resolveStream: YouTubeClient["resolveStream"],
  search: YouTubeClient["search"] = mock(() =>
    Promise.reject(new Error("unused"))
  )
): YouTubeClient {
  return {
    providers: [],
    resolveItem: mock(() => Promise.reject(new Error("unused"))),
    resolveStream,
    search,
  };
}

const spotifyPlaylist: Radio = {
  name: "Spring 24",
  platformMetadata: {
    itemType: "playlist",
    platform: "spotify",
    spotifyId: "432nsnOM9L55tkiOFnHbI2",
    tracks: [
      {
        artist: "Leonard Cohen",
        duration: 285,
        name: "You Want It Darker",
        spotifyId: "5eXyjGDzy8wrEn1pzu13uM",
        streamUrl: "spotify:track:5eXyjGDzy8wrEn1pzu13uM",
        url: "https://open.spotify.com/track/5eXyjGDzy8wrEn1pzu13uM",
      },
    ],
    url: "https://open.spotify.com/playlist/432nsnOM9L55tkiOFnHbI2",
  },
  streamUrl: "https://media.example/first.webm",
};

describe("DJ platform stream port", () => {
  test("resolves lazy YouTube IDs through the browser client", async () => {
    const resolveStream = mock(() =>
      Promise.resolve("https://media.example/audio.webm")
    );

    await expect(
      resolveDjPlatformStreamUrl(
        {
          platform: "youtube",
          radio,
          reason: "initial-load",
          videoId: "abcdefghijk",
        },
        { getYouTubeClient: () => youtubeClient(resolveStream) }
      )
    ).resolves.toEqual({
      streamFormat: "progressive",
      streamUrl: "https://media.example/audio.webm",
    });
    expect(resolveStream).toHaveBeenCalledWith("abcdefghijk");
  });

  test("fails closed when client initialization or provider resolution fails", async () => {
    const input = {
      platform: "youtube" as const,
      radio,
      reason: "stream-refresh" as const,
      videoId: "abcdefghijk",
    };

    await expect(
      resolveDjPlatformStreamUrl(input, {
        getYouTubeClient: () => {
          throw new Error("YouTube client unavailable");
        },
      })
    ).resolves.toBeNull();
    await expect(
      resolveDjPlatformStreamUrl(input, {
        getYouTubeClient: () =>
          youtubeClient(() => Promise.reject(new Error("Provider failed"))),
      })
    ).resolves.toBeNull();
  });

  test("matches a lazy Spotify track on YouTube and reports the upload", async () => {
    const search = mock(() =>
      Promise.resolve([
        {
          author: "Leonard Cohen",
          duration: 285,
          title: "You Want It Darker",
          videoId: "f7j4s2FURH8",
        },
      ])
    );
    const resolveStream = mock((videoId: string) =>
      Promise.resolve(`https://media.example/${videoId}.webm`)
    );

    await expect(
      resolveDjPlatformStreamUrl(
        {
          platform: "spotify",
          radio: spotifyPlaylist,
          reason: "playlist-next",
          spotifyId: "5eXyjGDzy8wrEn1pzu13uM",
        },
        { getYouTubeClient: () => youtubeClient(resolveStream, search) }
      )
    ).resolves.toEqual({
      streamFormat: "progressive",
      streamUrl: "https://media.example/f7j4s2FURH8.webm",
      youtubeVideoId: "f7j4s2FURH8",
    });
    expect(search).toHaveBeenCalledWith(
      "Leonard Cohen You Want It Darker",
      "songs",
      undefined
    );
  });

  test("fails a Spotify track closed when nothing matches or it is not listed", async () => {
    const input = {
      platform: "spotify" as const,
      radio: spotifyPlaylist,
      reason: "playlist-next" as const,
      spotifyId: "5eXyjGDzy8wrEn1pzu13uM",
    };
    const resolveStream = mock(() => Promise.resolve("unused"));
    const client = youtubeClient(resolveStream, () => Promise.resolve([]));
    await expect(
      resolveDjPlatformStreamUrl(input, { getYouTubeClient: () => client })
    ).resolves.toBeNull();
    await expect(
      resolveDjPlatformStreamUrl(
        { ...input, spotifyId: "0000000000000000000000" },
        { getYouTubeClient: () => client }
      )
    ).resolves.toBeNull();
    expect(resolveStream).not.toHaveBeenCalled();
  });

  test("delegates canonical Mixcloud refreshes through the platform seam", async () => {
    const canonicalUrl = "https://www.mixcloud.com/dholbach/cryptkeeper/";
    const streamUrl = "https://aod.mixcloud.stream/secure/hls/a.m4a/index.m3u8";
    const resolvePlatformItem = mock(() =>
      Promise.resolve({
        format: "hls" as const,
        metadata: {
          itemType: "show" as const,
          platform: "mixcloud" as const,
          url: canonicalUrl,
        },
        streamUrl,
      })
    );
    await expect(
      resolveDjPlatformStreamUrl(
        {
          canonicalUrl,
          platform: "mixcloud",
          radio: { name: "Cryptkeeper", streamUrl },
          reason: "stream-refresh",
        },
        { resolvePlatformItem }
      )
    ).resolves.toEqual({ streamFormat: "hls", streamUrl });
    expect(resolvePlatformItem).toHaveBeenCalledWith(canonicalUrl);
  });

  test("delegates canonical SoundCloud refreshes through the platform seam", async () => {
    const input = {
      canonicalUrl: "https://soundcloud.com/artist/canonical-track",
      platform: "soundcloud" as const,
      radio: {
        enabled: true,
        id: "soundcloud-test",
        name: "SoundCloud test",
        streamUrl: "https://soundcloud-media.example/expired.mp3",
      },
      reason: "stream-refresh" as const,
    };
    const resolvePlatformItem = mock(() =>
      Promise.resolve({
        format: "progressive" as const,
        metadata: {
          itemType: "track" as const,
          platform: "soundcloud" as const,
          url: input.canonicalUrl,
        },
        streamUrl: "https://soundcloud-media.example/fresh.mp3",
      })
    );

    await expect(
      resolveDjPlatformStreamUrl(input, { resolvePlatformItem })
    ).resolves.toEqual({
      streamFormat: "progressive",
      streamUrl: "https://soundcloud-media.example/fresh.mp3",
    });
    expect(resolvePlatformItem).toHaveBeenCalledWith(input.canonicalUrl);
  });

  test("delegates canonical Bandcamp refreshes through the same platform seam", async () => {
    const input = {
      canonicalUrl: "https://artist.bandcamp.com/track/canonical-track",
      platform: "bandcamp" as const,
      radio: {
        enabled: true,
        id: "bandcamp-test",
        name: "Bandcamp test",
        streamUrl: "https://bandcamp-media.example/expired.mp3",
      },
      reason: "stream-refresh" as const,
    };
    const resolvePlatformItem = mock(() =>
      Promise.resolve({
        format: "progressive" as const,
        metadata: {
          itemType: "track" as const,
          platform: "bandcamp" as const,
          url: input.canonicalUrl,
        },
        streamUrl: "https://bandcamp-media.example/fresh.mp3",
      })
    );

    await expect(
      resolveDjPlatformStreamUrl(input, { resolvePlatformItem })
    ).resolves.toEqual({
      streamFormat: "progressive",
      streamUrl: "https://bandcamp-media.example/fresh.mp3",
    });
    expect(resolvePlatformItem).toHaveBeenCalledWith(input.canonicalUrl);
  });

  test("fails canonical refresh closed when platform resolution fails", async () => {
    await expect(
      resolveDjPlatformStreamUrl(
        {
          canonicalUrl: "https://soundcloud.com/artist/canonical-track",
          platform: "soundcloud",
          radio: {
            enabled: true,
            id: "soundcloud-test",
            name: "SoundCloud test",
            streamUrl: "https://soundcloud-media.example/expired.mp3",
          },
          reason: "stream-refresh",
        },
        {
          resolvePlatformItem: () =>
            Promise.reject(new Error("resolver unavailable")),
        }
      )
    ).resolves.toBeNull();
  });

  test("refreshes the current collection track instead of restarting the first track", async () => {
    const expiredFirst = "https://media.example/expired-first.mp3";
    const expiredSecond = "https://media.example/expired-second.mp3";
    const freshSecond = "https://media.example/extensionless-second";
    const playlistRadio: Radio = {
      enabled: true,
      id: "soundcloud-playlist",
      name: "SoundCloud playlist",
      platformMetadata: {
        itemType: "playlist",
        platform: "soundcloud",
        tracks: [
          { name: "First", streamUrl: expiredFirst },
          { name: "Second", streamUrl: expiredSecond },
        ],
        url: "https://soundcloud.com/artist/playlist",
      },
      streamFormat: "progressive",
      streamUrl: expiredSecond,
    };
    const resolve = mock(() =>
      Promise.resolve({
        format: "progressive" as const,
        metadata: {
          itemType: "playlist" as const,
          platform: "soundcloud" as const,
          tracks: [
            {
              name: "First",
              streamUrl: "https://media.example/fresh-first.mp3",
            },
            { format: "hls" as const, name: "Second", streamUrl: freshSecond },
          ],
          url: "https://soundcloud.com/artist/playlist",
        },
        streamUrl: "https://media.example/fresh-first.mp3",
      })
    );

    await expect(
      resolveDjPlatformStreamUrl(
        {
          canonicalUrl: "https://soundcloud.com/artist/playlist",
          platform: "soundcloud",
          radio: playlistRadio,
          reason: "stream-refresh",
        },
        {
          resolvePlatformItem: resolve,
        }
      )
    ).resolves.toEqual({
      streamFormat: "hls",
      streamUrl: freshSecond,
    });
    expect(playlistRadio.streamFormat).toBe("progressive");
  });

  test("carries the resolved format for an extensionless stream without mutating input", async () => {
    const platformMetadata = {
      itemType: "track" as const,
      platform: "soundcloud" as const,
      url: "https://soundcloud.com/artist/live",
    };
    const inputRadio: Radio = {
      id: "soundcloud-live",
      name: "SoundCloud live",
      platformMetadata,
      streamFormat: "progressive",
      streamUrl: "https://media.example/expired.mp3",
    };

    await expect(
      resolveDjPlatformStreamUrl(
        {
          canonicalUrl: "https://soundcloud.com/artist/live",
          platform: "soundcloud",
          radio: inputRadio,
          reason: "stream-refresh",
        },
        {
          resolvePlatformItem: mock(() =>
            Promise.resolve({
              format: "hls" as const,
              metadata: platformMetadata,
              streamUrl: "https://media.example/extensionless",
            })
          ),
        }
      )
    ).resolves.toEqual({
      streamFormat: "hls",
      streamUrl: "https://media.example/extensionless",
    });
    expect(inputRadio.streamFormat).toBe("progressive");
    expect(inputRadio.streamUrl).toBe("https://media.example/expired.mp3");
  });
});
