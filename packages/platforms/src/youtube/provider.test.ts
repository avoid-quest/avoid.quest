import { describe, expect, mock, test } from "bun:test";
import { createYouTubeClient } from "./client";
import { createBrowserInvidiousAdapter } from "./invidious-browser";
import { createPipedAdapter } from "./piped";
import {
  type YouTubeProviderAdapter,
  YouTubeProviderAggregateError,
  YouTubeProviderError,
} from "./provider";

const VIDEO_ID = "abcdefghijk";
const PLAYLIST_ID = "PLabcdefghijk";

function json(value: unknown): Response {
  return Response.json(value);
}

function media(): Response {
  return new Response(new Uint8Array([0]), {
    headers: { "Content-Type": "audio/webm" },
    status: 206,
  });
}

function thumbnail(url = "/vi/abcdefghijk/high.jpg") {
  return { height: 480, quality: "high", url, width: 640 };
}

function invidiousVideo() {
  return {
    adaptiveFormats: [
      {
        bitrate: "128000",
        clen: "1000",
        container: "webm",
        encoding: "opus",
        type: "audio/webm",
        url: "/videoplayback/audio",
      },
    ],
    author: "Artist",
    lengthSeconds: 180,
    liveNow: false,
    title: "Track",
    videoId: VIDEO_ID,
    videoThumbnails: [thumbnail()],
  };
}

function pipedVideo() {
  return {
    audioStreams: [
      {
        bitrate: 128_000,
        codec: "opus",
        mimeType: "audio/webm",
        url: "https://proxy.piped.test/audio",
      },
    ],
    duration: 180,
    livestream: false,
    thumbnailUrl: "https://proxy.piped.test/thumb.jpg",
    title: "Track",
    uploader: "Artist",
  };
}

describe("browser Invidious adapter", () => {
  test("does not follow provider JSON redirects to loopback", async () => {
    const fetchImpl = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      return Promise.resolve(
        Response.redirect("http://127.0.0.1/private-api", 302)
      );
    });
    const adapter = createBrowserInvidiousAdapter({
      baseUrl: "https://invidious.test",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(adapter.probe()).rejects.toMatchObject({
      code: "http",
      status: 302,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("rejects JSON whose declared body exceeds the configured cap", async () => {
    const adapter = createBrowserInvidiousAdapter({
      baseUrl: "https://invidious.test",
      fetchImpl: mock(() =>
        Promise.resolve(
          new Response("{}", {
            headers: {
              "Content-Length": "100",
              "Content-Type": "application/json",
            },
          })
        )
      ) as typeof fetch,
      maxResponseBytes: 16,
    });

    await expect(adapter.probe()).rejects.toMatchObject({
      code: "response-too-large",
    });
  });

  test("maps search results and sends anonymous browser-safe requests", async () => {
    const fetchImpl = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe("omit");
      expect(init?.referrerPolicy).toBe("no-referrer");
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      return Promise.resolve(
        json([
          {
            author: "Artist",
            lengthSeconds: 125,
            title: "Track",
            type: "video",
            videoId: VIDEO_ID,
            videoThumbnails: [thumbnail()],
            viewCount: 1_200_000,
          },
        ])
      );
    });
    const adapter = createBrowserInvidiousAdapter({
      baseUrl: "https://invidious.test",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(adapter.search("ambient", "songs")).resolves.toEqual([
      {
        author: "Artist",
        duration: 125,
        thumbnail: "https://invidious.test/vi/abcdefghijk/high.jpg",
        title: "Track",
        videoId: VIDEO_ID,
        views: "1.2M views",
      },
    ]);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://invidious.test/api/v1/search?q=ambient&type=video"
    );
  });

  test("rejects a 200 HTML frontend as the wrong service", async () => {
    const adapter = createBrowserInvidiousAdapter({
      baseUrl: "https://wrong.test",
      fetchImpl: mock(() =>
        Promise.resolve(
          new Response("<!doctype html><title>Radio</title>", {
            headers: { "Content-Type": "text/html" },
          })
        )
      ) as typeof fetch,
    });

    await expect(adapter.probe()).rejects.toMatchObject({
      code: "unexpected-content-type",
      kind: "invidious",
    });
  });

  test("rejects valid JSON with the wrong schema", async () => {
    const adapter = createBrowserInvidiousAdapter({
      baseUrl: "https://wrong.test",
      fetchImpl: mock(() =>
        Promise.resolve(json({ software: { name: "radio" } }))
      ) as typeof fetch,
    });

    await expect(adapter.probe()).rejects.toMatchObject({
      code: "invalid-schema",
      kind: "invidious",
    });
  });

  test("distinguishes malformed JSON from a provider outage", async () => {
    const adapter = createBrowserInvidiousAdapter({
      baseUrl: "https://wrong.test",
      fetchImpl: mock(() =>
        Promise.resolve(
          new Response("{not-json", {
            headers: { "Content-Type": "application/json" },
          })
        )
      ) as typeof fetch,
    });

    await expect(adapter.probe()).rejects.toMatchObject({
      code: "invalid-json",
      kind: "invidious",
    });
  });

  test("resolves and CORS-probes a local Companion audio URL", async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const adapter = createBrowserInvidiousAdapter({
      baseUrl: "https://invidious.test",
      fetchImpl: mock((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ init, url: String(input) });
        return Promise.resolve(
          String(input).includes("/videoplayback/")
            ? media()
            : json(invidiousVideo())
        );
      }) as typeof fetch,
    });

    await expect(adapter.resolveStream(VIDEO_ID)).resolves.toBe(
      "https://invidious.test/videoplayback/audio"
    );
    expect(requests[1]?.url).toBe("https://invidious.test/videoplayback/audio");
    expect(new Headers(requests[1]?.init?.headers).get("Range")).toBe(
      "bytes=0-0"
    );
  });

  test("maps playlists to lazy video IDs without resolving every stream", async () => {
    const adapter = createBrowserInvidiousAdapter({
      baseUrl: "https://invidious.test",
      fetchImpl: mock(() =>
        Promise.resolve(
          json({
            author: "Artist",
            playlistId: PLAYLIST_ID,
            playlistThumbnail: "https://invidious.test/playlist.jpg",
            title: "Playlist",
            videoCount: 1,
            videos: [
              {
                lengthSeconds: 180,
                title: "Track",
                videoId: VIDEO_ID,
                videoThumbnails: [thumbnail()],
              },
            ],
          })
        )
      ) as typeof fetch,
    });

    const result = await adapter.resolveItem(
      `https://youtube.com/playlist?list=${PLAYLIST_ID}`
    );
    expect(result.streamUrl).toBe(`yt:${VIDEO_ID}`);
    expect(result.metadata.tracks?.[0]?.streamUrl).toBe(`yt:${VIDEO_ID}`);
  });
});

describe("Piped adapter", () => {
  test("rejects a chunked health response that exceeds the configured cap", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("OK"));
        controller.enqueue(new TextEncoder().encode("!!"));
        controller.close();
      },
    });
    const adapter = createPipedAdapter({
      baseUrl: "https://piped.test",
      fetchImpl: mock(() =>
        Promise.resolve(new Response(body))
      ) as typeof fetch,
      maxResponseBytes: 3,
    });

    await expect(adapter.probe()).rejects.toMatchObject({
      code: "response-too-large",
    });
  });

  test("invokes browser fetch without an illegal receiver", async () => {
    let receiver: unknown = null;
    const fetchImpl = function (
      this: unknown,
      _input: RequestInfo | URL,
      init?: RequestInit
    ) {
      receiver = this;
      expect(init?.redirect).toBe("error");
      return Promise.resolve(new Response("OK"));
    };
    const adapter = createPipedAdapter({
      baseUrl: "https://piped.test",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(adapter.probe()).resolves.toMatchObject({ status: "ready" });
    expect(receiver).toBeUndefined();
  });

  test("maps the music search filter and stream results", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(
        json({
          items: [
            {
              duration: 125,
              thumbnail: "https://proxy.piped.test/thumb.jpg",
              title: "Track",
              type: "stream",
              uploaderName: "Artist",
              url: `/watch?v=${VIDEO_ID}`,
              views: 1200,
            },
            { name: "Ignored channel", type: "channel", url: "/channel/id" },
          ],
        })
      )
    );
    const adapter = createPipedAdapter({
      baseUrl: "https://piped.test",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(adapter.search("ambient", "songs")).resolves.toEqual([
      {
        author: "Artist",
        duration: 125,
        thumbnail: "https://proxy.piped.test/thumb.jpg",
        title: "Track",
        videoId: VIDEO_ID,
        views: "1.2K views",
      },
    ]);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://piped.test/search?q=ambient&filter=music_songs"
    );
  });

  test("selects and CORS-probes the best proxied audio stream", async () => {
    const requests: string[] = [];
    const adapter = createPipedAdapter({
      baseUrl: "https://piped.test",
      fetchImpl: mock((input: RequestInfo | URL) => {
        requests.push(String(input));
        return Promise.resolve(
          String(input).includes("proxy.piped.test")
            ? media()
            : json(pipedVideo())
        );
      }) as typeof fetch,
    });

    await expect(adapter.resolveStream(VIDEO_ID)).resolves.toBe(
      "https://proxy.piped.test/audio"
    );
    expect(requests).toEqual([
      `https://piped.test/streams/${VIDEO_ID}`,
      "https://proxy.piped.test/audio",
    ]);
  });

  test("does not follow media probe redirects to loopback", async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const adapter = createPipedAdapter({
      baseUrl: "https://piped.test",
      fetchImpl: mock((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ init, url: String(input) });
        return Promise.resolve(
          String(input).includes("proxy.piped.test")
            ? Response.redirect("http://127.0.0.1/private-media", 302)
            : json(pipedVideo())
        );
      }) as typeof fetch,
    });

    await expect(adapter.resolveStream(VIDEO_ID)).rejects.toMatchObject({
      code: "http",
      status: 302,
    });
    expect(requests).toHaveLength(2);
    expect(requests.every(({ init }) => init?.redirect === "error")).toBe(true);
  });

  test("rejects internal stream URLs returned by a public provider", async () => {
    const video = pipedVideo();
    const stream = video.audioStreams[0];
    if (!stream) {
      throw new Error("Expected fixture audio stream");
    }
    stream.url = "http://127.0.0.1/private-audio";
    const adapter = createPipedAdapter({
      baseUrl: "https://piped.test",
      fetchImpl: mock(() => Promise.resolve(json(video))) as typeof fetch,
      verifyMedia: false,
    });

    await expect(adapter.resolveStream(VIDEO_ID)).rejects.toMatchObject({
      code: "invalid-schema",
    });
  });

  test("allows loopback media returned by a loopback development provider", async () => {
    const video = pipedVideo();
    const stream = video.audioStreams[0];
    if (!stream) {
      throw new Error("Expected fixture audio stream");
    }
    stream.url = "http://127.0.0.1:4100/audio";
    const adapter = createPipedAdapter({
      baseUrl: "http://localhost:4100",
      fetchImpl: mock(() => Promise.resolve(json(video))) as typeof fetch,
      verifyMedia: false,
    });

    await expect(adapter.resolveStream(VIDEO_ID)).resolves.toBe(
      "http://127.0.0.1:4100/audio"
    );
  });

  test("maps playlists to lazy video IDs", async () => {
    const adapter = createPipedAdapter({
      baseUrl: "https://piped.test",
      fetchImpl: mock(() =>
        Promise.resolve(
          json({
            name: "Playlist",
            relatedStreams: [
              {
                duration: 180,
                thumbnail: "https://proxy.piped.test/thumb.jpg",
                title: "Track",
                url: `/watch?v=${VIDEO_ID}`,
              },
            ],
            thumbnailUrl: "https://proxy.piped.test/playlist.jpg",
            uploader: "Artist",
            videos: 1,
          })
        )
      ) as typeof fetch,
    });

    const result = await adapter.resolveItem(
      `https://youtube.com/playlist?list=${PLAYLIST_ID}`
    );
    expect(result.streamUrl).toBe(`yt:${VIDEO_ID}`);
    expect(result.metadata.tracks?.[0]?.videoId).toBe(VIDEO_ID);
  });
});

function fakeAdapter(
  id: string,
  search: YouTubeProviderAdapter["search"]
): YouTubeProviderAdapter {
  return {
    id,
    kind: id === "first" ? "invidious" : "piped",
    probe: mock(() =>
      Promise.resolve({
        kind: id === "first" ? "invidious" : "piped",
        providerId: id,
        status: "ready" as const,
      })
    ),
    resolveItem: mock(() => Promise.reject(new Error("unused"))),
    resolveStream: mock(() => Promise.reject(new Error("unused"))),
    search,
  };
}

describe("ordered YouTube provider failover", () => {
  test("falls through retryable protocol failures in configured order", async () => {
    const firstSearch = mock(() =>
      Promise.reject(
        new YouTubeProviderError("wrong schema", {
          code: "invalid-schema",
          kind: "invidious",
          providerId: "first",
        })
      )
    );
    const secondSearch = mock(() =>
      Promise.resolve([{ author: "Artist", title: "Track", videoId: VIDEO_ID }])
    );
    const client = createYouTubeClient([
      fakeAdapter("first", firstSearch),
      fakeAdapter("second", secondSearch),
    ]);

    await expect(client.search("ambient")).resolves.toHaveLength(1);
    expect(firstSearch).toHaveBeenCalledTimes(1);
    expect(secondSearch).toHaveBeenCalledTimes(1);
  });

  test("treats the first valid empty search as success", async () => {
    const firstSearch = mock(() => Promise.resolve([]));
    const secondSearch = mock(() =>
      Promise.resolve([{ author: "Artist", title: "Track", videoId: VIDEO_ID }])
    );
    const client = createYouTubeClient([
      fakeAdapter("first", firstSearch),
      fakeAdapter("second", secondSearch),
    ]);

    await expect(client.search("no results")).resolves.toEqual([]);
    expect(secondSearch).not.toHaveBeenCalled();
  });

  test("reports all retryable failures without losing provider diagnostics", async () => {
    const failed = (id: string, kind: "invidious" | "piped") =>
      mock(() =>
        Promise.reject(
          new YouTubeProviderError("offline", {
            code: "network-or-cors",
            kind,
            providerId: id,
          })
        )
      );
    const client = createYouTubeClient([
      fakeAdapter("first", failed("first", "invidious")),
      fakeAdapter("second", failed("second", "piped")),
    ]);

    try {
      await client.search("ambient");
      throw new Error("Expected every provider to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(YouTubeProviderAggregateError);
      expect((error as YouTubeProviderAggregateError).errors).toHaveLength(2);
    }
  });

  test("classifies timeouts", async () => {
    const adapter = createBrowserInvidiousAdapter({
      baseUrl: "https://slow.test",
      fetchImpl: mock(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true }
            );
          })
      ) as typeof fetch,
      timeoutMs: 5,
    });

    await expect(adapter.probe()).rejects.toMatchObject({ code: "timeout" });
  });
});
