import { describe, expect, mock, test } from "bun:test";
import type { ResolverBroker } from "@avoid.quest/platforms/resolver";
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
  resolveStream: YouTubeClient["resolveStream"]
): YouTubeClient {
  return {
    providers: [],
    resolveItem: mock(() => Promise.reject(new Error("unused"))),
    resolveStream,
    search: mock(() => Promise.reject(new Error("unused"))),
  };
}

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

  test("fails closed when browser configuration or provider resolution fails", async () => {
    const input = {
      platform: "youtube" as const,
      radio,
      reason: "stream-refresh" as const,
      videoId: "abcdefghijk",
    };

    await expect(
      resolveDjPlatformStreamUrl(input, {
        getYouTubeClient: () => {
          throw new Error("No provider configured");
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

  test("delegates canonical SoundCloud refreshes through the provider-agnostic resolver seam", async () => {
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
    const resolveCanonicalStream = mock(() =>
      Promise.resolve({
        streamFormat: "progressive" as const,
        streamUrl: "https://soundcloud-media.example/fresh.mp3",
      })
    );

    await expect(
      resolveDjPlatformStreamUrl(input, { resolveCanonicalStream })
    ).resolves.toEqual({
      streamFormat: "progressive",
      streamUrl: "https://soundcloud-media.example/fresh.mp3",
    });
    expect(resolveCanonicalStream).toHaveBeenCalledWith(input);
  });

  test("delegates canonical Bandcamp refreshes through the same resolver seam", async () => {
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
    const resolveCanonicalStream = mock(() =>
      Promise.resolve({
        streamFormat: "progressive" as const,
        streamUrl: "https://bandcamp-media.example/fresh.mp3",
      })
    );

    await expect(
      resolveDjPlatformStreamUrl(input, { resolveCanonicalStream })
    ).resolves.toEqual({
      streamFormat: "progressive",
      streamUrl: "https://bandcamp-media.example/fresh.mp3",
    });
    expect(resolveCanonicalStream).toHaveBeenCalledWith(input);
  });

  test("fails canonical refresh closed when its configured resolver fails", async () => {
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
          resolveCanonicalStream: () =>
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
        resolverId: "external:test",
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
          getResolverBroker: () => ({
            resolve: resolve as unknown as ResolverBroker["resolve"],
          }),
        }
      )
    ).resolves.toEqual({
      streamFormat: "hls",
      streamUrl: freshSecond,
    });
    expect(playlistRadio.streamFormat).toBe("progressive");
  });

  test("carries resolver format for its primary extensionless stream without mutating input", async () => {
    const inputRadio: Radio = {
      id: "soundcloud-live",
      name: "SoundCloud live",
      streamFormat: "progressive",
      streamUrl: "https://media.example/expired.mp3",
      platformMetadata: {
        itemType: "track",
        platform: "soundcloud",
        url: "https://soundcloud.com/artist/live",
      },
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
          getResolverBroker: () => ({
            resolve: mock(() =>
              Promise.resolve({
                format: "hls" as const,
                metadata: inputRadio.platformMetadata,
                resolverId: "external:test",
                streamUrl: "https://media.example/extensionless",
              })
            ) as unknown as ResolverBroker["resolve"],
          }),
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
