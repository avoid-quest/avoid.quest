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
const PUBLIC_ADDRESS = "93.184.216.34";

function json(value: unknown): Response {
  return Response.json(value);
}

function media(
  body: BodyInit | null = new Uint8Array([0]),
  headers: Record<string, string> = {}
): Response {
  return new Response(body, {
    headers: {
      "Content-Range": "bytes 0-65535/65536",
      "Content-Type": "audio/webm",
      ...headers,
    },
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
    const resolveHostname = mock(async () => ["203.0.113.8"]);
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
            videoThumbnails: [
              thumbnail(),
              thumbnail("/vi/abcdefghijk/medium.jpg"),
            ],
            viewCount: 1_200_000,
          },
        ])
      );
    });
    const adapter = createBrowserInvidiousAdapter({
      baseUrl: "https://invidious.test",
      fetchImpl: fetchImpl as typeof fetch,
      resolveHostname,
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
    expect(resolveHostname).toHaveBeenCalledTimes(1);
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
      resolveHostname: async () => [PUBLIC_ADDRESS],
    });

    await expect(adapter.resolveStream(VIDEO_ID)).resolves.toBe(
      "https://invidious.test/videoplayback/audio"
    );
    expect(requests[1]?.url).toBe("https://invidious.test/videoplayback/audio");
    expect(new Headers(requests[1]?.init?.headers).get("Range")).toBe(
      "bytes=0-65535"
    );
  });

  test("accepts a range response whose Content-Range is not CORS-exposed", async () => {
    const adapter = createBrowserInvidiousAdapter({
      baseUrl: "https://invidious.test",
      fetchImpl: mock((input: RequestInfo | URL) =>
        Promise.resolve(
          String(input).includes("/videoplayback/")
            ? new Response(new Uint8Array([0]), {
                headers: {
                  "Content-Length": "65536",
                  "Content-Type": "audio/webm",
                },
                status: 206,
              })
            : json(invidiousVideo())
        )
      ) as typeof fetch,
      resolveHostname: async () => [PUBLIC_ADDRESS],
    });

    await expect(adapter.resolveStream(VIDEO_ID)).resolves.toBe(
      "https://invidious.test/videoplayback/audio"
    );
  });

  test("rejects media URLs whose hostname resolves to a private address", async () => {
    const video = invidiousVideo();
    const [stream] = video.adaptiveFormats;
    stream.url = "https://private-media.test/audio";
    video.videoThumbnails = [thumbnail("https://public-images.test/thumb.jpg")];
    const fetchImpl = mock(() => Promise.resolve(json(video)));
    const adapter = createBrowserInvidiousAdapter({
      baseUrl: "https://invidious.test",
      fetchImpl: fetchImpl as typeof fetch,
      resolveHostname: async (hostname) =>
        hostname === "private-media.test" ? ["127.0.0.1"] : [PUBLIC_ADDRESS],
    });

    await expect(adapter.resolveStream(VIDEO_ID)).rejects.toMatchObject({
      code: "invalid-schema",
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("rejects thumbnails whose hostname resolves to a private address", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(
        json([
          {
            author: "Artist",
            lengthSeconds: 125,
            title: "Track",
            type: "video",
            videoId: VIDEO_ID,
            videoThumbnails: [
              thumbnail("https://private-images.test/thumb.jpg"),
            ],
            viewCount: 1200,
          },
        ])
      )
    );
    const adapter = createBrowserInvidiousAdapter({
      baseUrl: "https://invidious.test",
      fetchImpl: fetchImpl as typeof fetch,
      resolveHostname: async () => ["192.168.1.10"],
    });

    await expect(adapter.search("ambient")).rejects.toMatchObject({
      code: "invalid-schema",
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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

  test("classifies malformed result URLs as retryable provider schema errors", async () => {
    const adapter = createPipedAdapter({
      baseUrl: "https://piped.test",
      fetchImpl: mock(() =>
        Promise.resolve(
          json({
            items: [
              {
                duration: 125,
                thumbnail: "https://proxy.piped.test/thumb.jpg",
                title: "Track",
                type: "stream",
                uploaderName: "Artist",
                url: "/watch?v=invalid",
                views: 1200,
              },
            ],
          })
        )
      ) as typeof fetch,
    });

    await expect(adapter.search("ambient")).rejects.toMatchObject({
      code: "invalid-schema",
      retryable: true,
    });
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
      resolveHostname: async () => [PUBLIC_ADDRESS],
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
    const [stream] = video.audioStreams;
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

  test("rejects media URLs whose hostname resolves to a private address", async () => {
    const video = pipedVideo();
    const [stream] = video.audioStreams;
    stream.url = "https://private-media.test/audio";
    video.thumbnailUrl = "https://public-images.test/thumb.jpg";
    const fetchImpl = mock(() => Promise.resolve(json(video)));
    const adapter = createPipedAdapter({
      baseUrl: "https://piped.test",
      fetchImpl: fetchImpl as typeof fetch,
      resolveHostname: async (hostname) =>
        hostname === "private-media.test" ? ["10.0.0.1"] : [PUBLIC_ADDRESS],
    });

    await expect(adapter.resolveStream(VIDEO_ID)).rejects.toMatchObject({
      code: "invalid-schema",
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("rejects thumbnails whose hostname resolves to a private address", async () => {
    const fetchImpl = mock(() =>
      Promise.resolve(
        json({
          items: [
            {
              duration: 125,
              thumbnail: "https://private-images.test/thumb.jpg",
              title: "Track",
              type: "stream",
              uploaderName: "Artist",
              url: `/watch?v=${VIDEO_ID}`,
              views: 1200,
            },
          ],
        })
      )
    );
    const adapter = createPipedAdapter({
      baseUrl: "https://piped.test",
      fetchImpl: fetchImpl as typeof fetch,
      resolveHostname: async () => ["172.16.0.1"],
    });

    await expect(adapter.search("ambient")).rejects.toMatchObject({
      code: "invalid-schema",
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("rejects media URLs with embedded credentials", async () => {
    const video = pipedVideo();
    const [stream] = video.audioStreams;
    stream.url = "https://user:password@proxy.piped.test/audio";
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
    const [stream] = video.audioStreams;
    stream.url = "http://127.0.0.1:4100/audio";
    video.thumbnailUrl = "http://127.0.0.1:4100/thumb.jpg";
    const resolveHostname = mock(() =>
      Promise.reject(new Error("Loopback media must not use public DNS"))
    );
    const adapter = createPipedAdapter({
      baseUrl: "http://localhost:4100",
      fetchImpl: mock(() => Promise.resolve(json(video))) as typeof fetch,
      resolveHostname,
      verifyMedia: false,
    });

    await expect(adapter.resolveStream(VIDEO_ID)).resolves.toBe(
      "http://127.0.0.1:4100/audio"
    );
    expect(resolveHostname).not.toHaveBeenCalled();
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
  const invalidMediaResponses: ReadonlyArray<
    readonly [string, () => Response]
  > = [
    ["an empty response", () => media(null)],
    [
      "a plain-text response",
      () => media("not audio", { "Content-Type": "text/plain" }),
    ],
    [
      "an invalid content range",
      () => media(new Uint8Array([0]), { "Content-Range": "bytes 1-1/2" }),
    ],
    [
      "a hidden content range with the wrong response length",
      () =>
        new Response(new Uint8Array([0]), {
          headers: {
            "Content-Length": "1",
            "Content-Type": "audio/webm",
          },
          status: 206,
        }),
    ],
  ];

  for (const [description, invalidMedia] of invalidMediaResponses) {
    test(`falls through a provider that returns ${description}`, async () => {
      const first = createPipedAdapter({
        baseUrl: "https://piped.test",
        fetchImpl: mock((input: RequestInfo | URL) =>
          Promise.resolve(
            String(input).includes("proxy.piped.test")
              ? invalidMedia()
              : json(pipedVideo())
          )
        ) as typeof fetch,
        id: "first",
        resolveHostname: async () => [PUBLIC_ADDRESS],
      });
      const secondResolveStream = mock(() =>
        Promise.resolve("https://public-media.test/audio")
      );
      const second: YouTubeProviderAdapter = {
        ...fakeAdapter("second", () => Promise.reject(new Error("unused"))),
        resolveStream: secondResolveStream,
      };

      await expect(
        createYouTubeClient([first, second]).resolveStream(VIDEO_ID)
      ).resolves.toBe("https://public-media.test/audio");
      expect(secondResolveStream).toHaveBeenCalledTimes(1);
    });
  }

  test("falls through a provider that returns private-resolving media", async () => {
    const video = pipedVideo();
    const [stream] = video.audioStreams;
    stream.url = "https://private-media.test/audio";
    video.thumbnailUrl = "https://public-images.test/thumb.jpg";
    const first = createPipedAdapter({
      baseUrl: "https://piped.test",
      fetchImpl: mock(() => Promise.resolve(json(video))) as typeof fetch,
      id: "first",
      resolveHostname: async (hostname) =>
        hostname === "private-media.test" ? ["127.0.0.1"] : [PUBLIC_ADDRESS],
    });
    const secondResolveStream = mock(() =>
      Promise.resolve("https://public-media.test/audio")
    );
    const second: YouTubeProviderAdapter = {
      id: "second",
      kind: "invidious",
      probe: mock(() =>
        Promise.resolve({
          kind: "invidious",
          providerId: "second",
          status: "ready" as const,
        })
      ),
      resolveItem: mock(() => Promise.reject(new Error("unused"))),
      resolveStream: secondResolveStream,
      search: mock(() => Promise.reject(new Error("unused"))),
    };

    await expect(
      createYouTubeClient([first, second]).resolveStream(VIDEO_ID)
    ).resolves.toBe("https://public-media.test/audio");
    expect(secondResolveStream).toHaveBeenCalledTimes(1);
  });

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
