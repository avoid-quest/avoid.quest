import { describe, expect, mock, test } from "bun:test";
import {
  ClientStaticAudioResolverError,
  resolveClientStaticAudio,
} from "./client-static-audio-resolver";

const NO_RELAYS = () => [];

function playlistResponse(
  body: BodyInit,
  contentType = "audio/x-mpegurl"
): Response {
  return new Response(body, { headers: { "Content-Type": contentType } });
}

describe("resolveClientStaticAudio", () => {
  test.each([
    ["mp3", "audio/mpeg"],
    ["wav", "audio/wav"],
    ["ogg", "audio/ogg"],
    ["flac", "audio/flac"],
    ["m4a", "audio/mp4"],
    ["aac", "audio/aac"],
    ["webm", "audio/webm"],
    ["opus", "audio/ogg"],
  ])("resolves .%s files without any network request", async (ext, mimeType) => {
    const fetchImpl = mock(() =>
      Promise.reject(new Error("audio files must not be probed"))
    );
    const getRelayUrls = mock(() => {
      throw new Error("audio files must not load relay configuration");
    });
    const appServerFallback = mock(() =>
      Promise.reject(new Error("audio files must not use the app server"))
    );
    const url = `https://audio.example/deep_mix-01.${ext}?token=abc`;

    await expect(
      resolveClientStaticAudio(url, {
        appServerFallback,
        fetchImpl,
        getRelayUrls,
      })
    ).resolves.toEqual({
      attemptFailures: [],
      format: "progressive",
      metadata: {
        displayName: "deep mix 01",
        duration: 0,
        fileName: "deep mix 01",
        fileSize: 0,
        isLocal: false,
        itemType: "track",
        mimeType,
        platform: "static-audio",
        streamUrl: url,
        url,
      },
      streamUrl: url,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getRelayUrls).not.toHaveBeenCalled();
    expect(appServerFallback).not.toHaveBeenCalled();
  });

  test("rejects unsupported, non-HTTP, and credential-bearing URLs", async () => {
    await expect(
      resolveClientStaticAudio("https://audio.example/readme.txt")
    ).rejects.toThrow("supported audio file or playlist");
    await expect(
      resolveClientStaticAudio("file:///tmp/track.mp3")
    ).rejects.toThrow("HTTP or HTTPS");
    await expect(
      resolveClientStaticAudio("https://user:secret@audio.example/track.mp3")
    ).rejects.toThrow("must not contain credentials");
  });

  test("parses a direct M3U with relative URLs, durations, and source order", async () => {
    const fetchImpl = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe("omit");
      expect(init?.referrerPolicy).toBe("no-referrer");
      expect(init?.cache).toBe("no-store");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(
        playlistResponse(`#EXTM3U
#EXTINF:7,First
tracks/first.mp3
#EXTINF:11,Second
../second.ogg`)
      );
    });
    const url = "https://audio.example/lists/mix.m3u";

    const result = await resolveClientStaticAudio(url, {
      fetchImpl,
      getRelayUrls: NO_RELAYS,
    });

    expect(result.attemptFailures).toEqual([]);
    expect(result.format).toBe("progressive");
    expect(result.streamUrl).toBe(
      "https://audio.example/lists/tracks/first.mp3"
    );
    expect(result.metadata).toMatchObject({
      displayName: "mix",
      duration: 18,
      itemType: "playlist",
      playlistFormat: "m3u",
      tracks: [
        {
          duration: 7,
          streamUrl: "https://audio.example/lists/tracks/first.mp3",
          title: "First",
        },
        {
          duration: 11,
          streamUrl: "https://audio.example/second.ogg",
          title: "Second",
        },
      ],
    });
  });

  test.each([
    {
      body: "#EXTM3U\n#EXTINF:-1,Live\nhttps://cdn.example/live.m3u8",
      contentType: "audio/x-mpegurl",
      extension: "m3u",
    },
    {
      body: "[playlist]\nFile1=https://cdn.example/live.m3u8\nTitle1=Live",
      contentType: "audio/x-scpls",
      extension: "pls",
    },
  ])("infers HLS from a .$extension playlist's selected stream", async ({
    body,
    contentType,
    extension,
  }) => {
    const result = await resolveClientStaticAudio(
      `https://audio.example/list.${extension}`,
      {
        fetchImpl: mock(() =>
          Promise.resolve(playlistResponse(body, contentType))
        ),
        getRelayUrls: NO_RELAYS,
      }
    );

    expect(result.streamUrl).toBe("https://cdn.example/live.m3u8");
    expect(result.format).toBe("hls");
  });

  test("parses PLS entries locally in numeric order", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(
        playlistResponse(
          `[playlist]
File2=../two.ogg
Title2=Two
Length2=22
File1=one.mp3
Title1=One
Length1=11`,
          "audio/x-scpls; charset=utf-8"
        )
      )
    );

    const result = await resolveClientStaticAudio(
      "https://audio.example/lists/list.pls",
      {
        fetchImpl,
        getRelayUrls: NO_RELAYS,
      }
    );

    expect(result.metadata).toMatchObject({
      duration: 33,
      itemType: "playlist",
      mimeType: "audio/x-scpls",
      playlistFormat: "pls",
      tracks: [
        {
          duration: 11,
          streamUrl: "https://audio.example/lists/one.mp3",
          title: "One",
        },
        {
          duration: 22,
          streamUrl: "https://audio.example/two.ogg",
          title: "Two",
        },
      ],
    });
    expect(result.format).toBe("progressive");
  });

  test.each([
    {
      extension: "m3u",
      expectedFormat: "hls" as const,
      oppositeRelayFormat: "hls" as const,
      preferredRelayFormat: "progressive" as const,
      relayBody: "#EXTM3U\n#EXT-X-TARGETDURATION:6\nsegment.ts",
      streamUrl: "https://audio.example/list.m3u",
    },
    {
      extension: "m3u8",
      expectedFormat: "progressive" as const,
      oppositeRelayFormat: "progressive" as const,
      preferredRelayFormat: "hls" as const,
      relayBody: "#EXTM3U\n#EXTINF:3,Clip\nhttps://cdn.example/clip.mp3",
      streamUrl: "https://cdn.example/clip.mp3",
    },
  ])("falls back through a $oppositeRelayFormat relay for ambiguous .$extension content", async (fixture) => {
    const upstreamUrl = `https://audio.example/list.${fixture.extension}`;
    const relayUrl = "https://opposite-relay.example/playlist";
    const fetchImpl = mock((input: RequestInfo | URL) =>
      String(input) === upstreamUrl
        ? Promise.reject(new TypeError("CORS blocked"))
        : Promise.resolve(playlistResponse(fixture.relayBody))
    );
    const getRelayUrls = mock(
      (_url: string, format: "hls" | "progressive"): readonly string[] =>
        format === fixture.oppositeRelayFormat ? [relayUrl] : []
    );

    const result = await resolveClientStaticAudio(upstreamUrl, {
      fetchImpl,
      getRelayUrls,
    });

    expect(getRelayUrls.mock.calls.map(([, format]) => format)).toEqual([
      fixture.preferredRelayFormat,
      fixture.oppositeRelayFormat,
    ]);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      upstreamUrl,
      relayUrl,
    ]);
    expect(result.format).toBe(fixture.expectedFormat);
    expect(result.streamUrl).toBe(fixture.streamUrl);
  });

  test.each([
    {
      body: "#EXTM3U\n#EXTINF:-1,Private\nhttp://127.0.0.1:8000/audio.mp3",
      extension: "m3u",
    },
    {
      body: "[playlist]\nFile1=http://10.0.0.1/audio.mp3\nTitle1=Private",
      extension: "pls",
    },
  ])("rejects private nested tracks in a public .$extension playlist", async ({
    body,
    extension,
  }) => {
    try {
      await resolveClientStaticAudio(
        `https://audio.example/list.${extension}`,
        {
          fetchImpl: mock(() => Promise.resolve(playlistResponse(body))),
          getRelayUrls: NO_RELAYS,
        }
      );
      throw new Error("Expected private track rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ClientStaticAudioResolverError);
      expect(error).toMatchObject({
        attemptFailures: [{ code: "invalid-content", kind: "direct" }],
      });
    }
  });

  test("allows loopback tracks when the playlist itself is loopback", async () => {
    const result = await resolveClientStaticAudio(
      "http://localhost:3000/list.m3u",
      {
        fetchImpl: mock(() =>
          Promise.resolve(
            playlistResponse(
              "#EXTM3U\n#EXTINF:-1,Local\nhttp://127.0.0.1:8000/audio.mp3"
            )
          )
        ),
        getRelayUrls: NO_RELAYS,
      }
    );

    expect(result.streamUrl).toBe("http://127.0.0.1:8000/audio.mp3");
  });

  test("tries direct then compatible relays and exposes earlier failures", async () => {
    const upstreamUrl = "https://audio.example/list.m3u";
    const relayOne = "https://relay-one.example/api/stream-proxy?url=list";
    const relayTwo = "https://relay-two.example/api/stream-proxy?url=list";
    const calls: string[] = [];
    const fetchImpl = mock((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      expect(init?.credentials).toBe("omit");
      expect(init?.referrerPolicy).toBe("no-referrer");
      if (String(input) === upstreamUrl) {
        return Promise.reject(new TypeError("CORS blocked"));
      }
      if (String(input) === relayOne) {
        return Promise.resolve(
          playlistResponse("<html>not a playlist</html>", "text/html")
        );
      }
      return Promise.resolve(playlistResponse("track.mp3"));
    });
    const getRelayUrls = mock(() => [relayOne, relayTwo]);

    const result = await resolveClientStaticAudio(upstreamUrl, {
      fetchImpl,
      getRelayUrls,
    });

    expect(calls).toEqual([upstreamUrl, relayOne, relayTwo]);
    expect(getRelayUrls).toHaveBeenCalledWith(upstreamUrl, "progressive");
    expect(result.streamUrl).toBe("https://audio.example/track.mp3");
    expect(result.attemptFailures).toEqual([
      {
        code: "network-error",
        kind: "direct",
        message: "CORS blocked",
        url: upstreamUrl,
      },
      {
        code: "invalid-content-type",
        kind: "relay",
        message: "Unexpected playlist content type: text/html",
        url: relayOne,
      },
    ]);
  });

  test("keeps HLS master and media manifests as HLS streams", async () => {
    for (const directive of [
      "#EXT-X-STREAM-INF:BANDWIDTH=128000",
      "#EXT-X-TARGETDURATION:6",
    ]) {
      const url = "https://audio.example/live/master.m3u8";
      const fetchImpl = mock(() =>
        Promise.resolve(
          playlistResponse(
            `#EXTM3U\n${directive}\nrelative-child.m3u8`,
            "application/vnd.apple.mpegurl"
          )
        )
      );
      const getRelayUrls = mock(() => []);

      const result = await resolveClientStaticAudio(url, {
        fetchImpl,
        getRelayUrls,
      });

      expect(getRelayUrls).toHaveBeenCalledWith(url, "hls");
      expect(result.streamUrl).toBe(url);
      expect(result.format).toBe("hls");
      expect(result.metadata).toEqual({
        displayName: "master",
        duration: 0,
        fileName: "master",
        fileSize: 0,
        isLocal: false,
        itemType: "track",
        mimeType: "application/vnd.apple.mpegurl",
        platform: "static-audio",
        streamUrl: url,
        url,
      });
    }
  });

  test("detects HLS content served from an M3U URL", async () => {
    const url = "https://audio.example/live/manifest.m3u";
    const result = await resolveClientStaticAudio(url, {
      fetchImpl: mock(() =>
        Promise.resolve(
          playlistResponse(
            "#EXTM3U\n#EXT-X-TARGETDURATION:6\nsegment.ts",
            "audio/x-mpegurl"
          )
        )
      ),
      getRelayUrls: NO_RELAYS,
    });

    expect(result.format).toBe("hls");
    expect(result.streamUrl).toBe(url);
    expect(result.metadata.mimeType).toBe("application/vnd.apple.mpegurl");
  });

  test("parses an M3U8 without HLS directives as a simple audio list", async () => {
    const url = "https://audio.example/lists/simple.m3u8";
    const fetchImpl = mock(() =>
      Promise.resolve(
        playlistResponse(
          "#EXTM3U\n#EXTINF:3,Clip\n../clip.opus",
          "application/vnd.apple.mpegurl"
        )
      )
    );

    const result = await resolveClientStaticAudio(url, {
      fetchImpl,
      getRelayUrls: NO_RELAYS,
    });

    expect(result.metadata).toMatchObject({
      itemType: "playlist",
      playlistFormat: "m3u",
      streamUrl: "https://audio.example/clip.opus",
      tracks: [
        {
          duration: 3,
          streamUrl: "https://audio.example/clip.opus",
          title: "Clip",
        },
      ],
    });
  });

  test("enforces declared and streamed response size limits before fallback", async () => {
    const url = "https://audio.example/list.m3u";
    const relayUrl = "https://relay.example/list";
    const fetchImpl = mock((input: RequestInfo | URL) => {
      if (String(input) === url) {
        return Promise.resolve(
          new Response("short", {
            headers: {
              "Content-Length": "999",
              "Content-Type": "audio/x-mpegurl",
            },
          })
        );
      }
      return Promise.resolve(playlistResponse("a".repeat(65)));
    });
    const appServerFallback = mock(() =>
      Promise.resolve(playlistResponse("fallback.mp3"))
    );

    const result = await resolveClientStaticAudio(url, {
      appServerFallback,
      fetchImpl,
      getRelayUrls: () => [relayUrl],
      maxResponseBytes: 64,
    });

    expect(result.streamUrl).toBe("https://audio.example/fallback.mp3");
    expect(
      result.attemptFailures.map(({ code, kind }) => ({ code, kind }))
    ).toEqual([
      { code: "response-too-large", kind: "direct" },
      { code: "response-too-large", kind: "relay" },
    ]);
  });

  test("times out a direct attempt before trying a relay", async () => {
    const url = "https://audio.example/list.m3u";
    const relayUrl = "https://relay.example/list";
    const fetchImpl = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      if (String(_input) === relayUrl) {
        return Promise.resolve(playlistResponse("relay.mp3"));
      }
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Promise<Response>(() => undefined);
    });

    const result = await resolveClientStaticAudio(url, {
      fetchImpl,
      getRelayUrls: () => [relayUrl],
      timeoutMs: 5,
    });

    expect(result.attemptFailures[0]).toMatchObject({
      code: "timeout",
      kind: "direct",
    });
    expect(result.streamUrl).toBe("https://audio.example/relay.mp3");
  });

  test("uses and validates the injected app-server response last", async () => {
    const url = "https://audio.example/list.pls";
    const relayUrl = "https://relay.example/list";
    const fetchImpl = mock(() =>
      Promise.resolve(new Response("missing", { status: 404 }))
    );
    const appServerFallback = mock((upstreamUrl: string, init: RequestInit) => {
      expect(upstreamUrl).toBe(url);
      expect(init.credentials).toBe("omit");
      expect(init.referrerPolicy).toBe("no-referrer");
      return Promise.resolve(
        playlistResponse(
          "[playlist]\nFile1=server.mp3\nTitle1=Server",
          "audio/x-scpls"
        )
      );
    });

    const result = await resolveClientStaticAudio(url, {
      appServerFallback,
      fetchImpl,
      getRelayUrls: () => [relayUrl],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(appServerFallback).toHaveBeenCalledTimes(1);
    expect(result.attemptFailures.map(({ kind }) => kind)).toEqual([
      "direct",
      "relay",
    ]);
    expect(result.streamUrl).toBe("https://audio.example/server.mp3");
  });

  test("omits the injected app-server playlist fallback when compatibility fallbacks are disabled", async () => {
    const url = "https://audio.example/list.m3u";
    const fetchImpl = mock(() =>
      Promise.resolve(playlistResponse("not audio", "application/json"))
    );
    const appServerFallback = mock(() =>
      Promise.resolve(playlistResponse("server.mp3"))
    );

    try {
      await resolveClientStaticAudio(url, {
        allowCompatibilityFallbacks: false,
        appServerFallback,
        fetchImpl,
        getRelayUrls: () => ["https://relay.example/list"],
      });
      throw new Error("Expected resolution to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ClientStaticAudioResolverError);
      expect(
        (error as ClientStaticAudioResolverError).attemptFailures.map(
          ({ kind }) => kind
        )
      ).toEqual(["direct", "relay"]);
    }
    expect(appServerFallback).not.toHaveBeenCalled();
  });

  test("reports every candidate failure when resolution is exhausted", async () => {
    const url = "https://audio.example/list.m3u";
    const fetchImpl = mock(() =>
      Promise.resolve(playlistResponse("not audio", "application/json"))
    );
    const appServerFallback = mock(() =>
      Promise.resolve(playlistResponse("<html>error</html>"))
    );

    try {
      await resolveClientStaticAudio(url, {
        appServerFallback,
        fetchImpl,
        getRelayUrls: () => ["https://relay.example/list"],
      });
      throw new Error("Expected resolution to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ClientStaticAudioResolverError);
      expect(
        (error as ClientStaticAudioResolverError).attemptFailures.map(
          ({ code, kind }) => ({
            code,
            kind,
          })
        )
      ).toEqual([
        { code: "invalid-content-type", kind: "direct" },
        { code: "invalid-content-type", kind: "relay" },
        { code: "invalid-content", kind: "app-server" },
      ]);
    }
  });

  test("stops fallback attempts when the caller aborts", async () => {
    const controller = new AbortController();
    const fetchImpl = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      controller.abort("cancelled");
      return Promise.reject(init?.signal?.reason);
    });
    const appServerFallback = mock(() =>
      Promise.resolve(playlistResponse("must-not-run.mp3"))
    );

    try {
      await resolveClientStaticAudio("https://audio.example/list.m3u", {
        appServerFallback,
        fetchImpl,
        getRelayUrls: () => ["https://relay.example/list"],
        signal: controller.signal,
      });
      throw new Error("Expected resolution to abort");
    } catch (error) {
      expect(error).toBeInstanceOf(ClientStaticAudioResolverError);
      expect(
        (error as ClientStaticAudioResolverError).attemptFailures
      ).toMatchObject([{ code: "aborted", kind: "direct" }]);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(appServerFallback).not.toHaveBeenCalled();
  });
});
