import { describe, expect, mock, test } from "bun:test";
import {
  createPlayablePlatformResolver,
  detectPlayablePlatformFromUrl,
  normalizePlayablePlatformUrl,
  toPlayableSources,
} from "./playable";

describe("playable platform URL handling", () => {
  test("detects external platforms before static audio URLs", () => {
    expect(
      detectPlayablePlatformFromUrl("https://artist.bandcamp.com/track/song")
    ).toBe("bandcamp");
    expect(
      detectPlayablePlatformFromUrl("https://radio.garden/listen/foo/abc123")
    ).toBe("radiogarden");
    expect(detectPlayablePlatformFromUrl("https://example.com/live.m3u8")).toBe(
      "static-audio"
    );
    expect(
      detectPlayablePlatformFromUrl("https://example.com/page")
    ).toBeNull();
  });

  test("normalizes SoundCloud short links and mobile platform URLs", async () => {
    const resolveShortLink = mock(async () => "https://m.soundcloud.com/a/b");

    const normalized = await normalizePlayablePlatformUrl(
      " https://on.soundcloud.com/abc123 ",
      { resolveShortLink }
    );

    expect(normalized).toBe("https://soundcloud.com/a/b");
    expect(resolveShortLink).toHaveBeenCalledWith(
      "https://on.soundcloud.com/abc123"
    );
  });
});

describe("createPlayablePlatformResolver", () => {
  test("uses the static audio adapter for direct audio URLs", async () => {
    const resolveStaticAudioItem = mock(async (url: string) => ({
      metadata: {
        displayName: "mix",
        platform: "static-audio" as const,
        url,
      },
      streamUrl: url,
    }));
    const resolver = createPlayablePlatformResolver({ resolveStaticAudioItem });

    const result = await resolver.resolveItem("https://example.com/mix.mp3");

    expect(result).toEqual({
      item: {
        metadata: {
          displayName: "mix",
          platform: "static-audio",
          url: "https://example.com/mix.mp3",
        },
        normalizedUrl: "https://example.com/mix.mp3",
        platform: "static-audio",
        streamUrl: "https://example.com/mix.mp3",
      },
      success: true,
    });
  });

  test("reports unsupported URLs without calling adapters", async () => {
    const resolveStaticAudioItem = mock(async (url: string) => ({
      metadata: { platform: "static-audio" as const, url },
      streamUrl: url,
    }));
    const resolver = createPlayablePlatformResolver({ resolveStaticAudioItem });

    const result = await resolver.resolveItem("https://example.com/page");

    expect(result).toEqual({
      error: {
        code: "unsupported-url",
        message: "Unsupported URL",
      },
      success: false,
    });
    expect(resolveStaticAudioItem).not.toHaveBeenCalled();
  });

  test("maps static audio adapter failures to structured resolver errors", async () => {
    const resolveStaticAudioItem = mock(() =>
      Promise.reject(new Error("Static audio probe failed"))
    );
    const resolver = createPlayablePlatformResolver({ resolveStaticAudioItem });

    const result = await resolver.resolveItem("https://example.com/mix.mp3");

    expect(result).toEqual({
      error: {
        code: "static-audio-resolution-failed",
        message: "Static audio probe failed",
        platform: "static-audio",
      },
      success: false,
    });
  });

  test("maps Radio Garden stream failures to structured resolver errors", async () => {
    const originalFetch = globalThis.fetch;
    const fetchImpl = mock(async (input: RequestInfo | URL) => {
      await Promise.resolve();
      const url = String(input);

      if (url.includes("/ara/content/channel/abc123")) {
        return Response.json({
          apiVersion: 1,
          data: {
            country: {
              id: "jp",
              title: "Japan",
            },
            id: "abc123",
            place: {
              id: "tokyo",
              title: "Tokyo",
            },
            preroll: false,
            secure: true,
            stream: "",
            title: "Garden",
            type: "channel",
            url: "/listen/garden/abc123",
          },
          version: "1",
        });
      }

      if (url.includes("/ara/content/listen/abc123/channel.mp3")) {
        throw new Error("stream failed");
      }

      throw new Error(`Unexpected Radio Garden fetch: ${url}`);
    });

    globalThis.fetch = fetchImpl as typeof fetch;
    try {
      const resolver = createPlayablePlatformResolver();

      await expect(
        resolver.resolveItem("https://radio.garden/listen/garden/abc123")
      ).resolves.toEqual({
        error: {
          code: "provider-resolution-failed",
          message: "stream failed",
          platform: "radiogarden",
        },
        success: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("toPlayableSources", () => {
  test("flattens collection metadata into playable sources", () => {
    const sources = toPlayableSources({
      metadata: {
        artist: "Artist",
        itemType: "album",
        name: "Album",
        platform: "bandcamp",
        tracks: [
          { duration: 12, name: "One", streamUrl: "https://cdn.test/one.mp3" },
          { name: "Two", streamUrl: "https://cdn.test/two.mp3" },
        ],
        url: "https://artist.bandcamp.com/album/album",
      },
      normalizedUrl: "https://artist.bandcamp.com/album/album",
      platform: "bandcamp",
      streamUrl: "https://cdn.test/album.mp3",
    });

    expect(sources).toEqual([
      {
        artist: "Artist",
        duration: 12,
        isLiveStream: false,
        platform: "bandcamp",
        streamUrl: "https://cdn.test/one.mp3",
        title: "One",
        url: "https://artist.bandcamp.com/album/album",
      },
      {
        artist: "Artist",
        duration: undefined,
        isLiveStream: false,
        platform: "bandcamp",
        streamUrl: "https://cdn.test/two.mp3",
        title: "Two",
        url: "https://artist.bandcamp.com/album/album",
      },
    ]);
  });

  test("describes Radio Garden items as live sources", () => {
    const sources = toPlayableSources({
      metadata: {
        channelId: "abc123",
        countryTitle: "Japan",
        itemType: "channel",
        name: "Garden",
        placeTitle: "Tokyo",
        platform: "radiogarden",
        url: "https://radio.garden/listen/garden/abc123",
      },
      normalizedUrl: "https://radio.garden/listen/garden/abc123",
      platform: "radiogarden",
      streamUrl: "https://stream.test/live",
    });

    expect(sources).toEqual([
      {
        artist: "Tokyo, Japan",
        isLiveStream: true,
        platform: "radiogarden",
        streamUrl: "https://stream.test/live",
        title: "Garden",
        url: "https://radio.garden/listen/garden/abc123",
      },
    ]);
  });
});
