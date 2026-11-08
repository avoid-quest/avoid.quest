import { describe, expect, mock, test } from "bun:test";
import {
  CURATED_YOUTUBE_PROVIDERS,
  createCuratedYouTubeClient,
  YouTubeProviderUnavailableError,
} from "./client";

function pendingUntilAborted(init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const rejectAbort = () =>
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) {
      rejectAbort();
    } else {
      signal?.addEventListener("abort", rejectAbort, { once: true });
    }
  });
}

describe("curated YouTube client", () => {
  test("keeps every playback-capable provider in curated order", () => {
    expect(CURATED_YOUTUBE_PROVIDERS).toEqual([
      {
        baseUrl: "https://pipedapi.wireway.ch",
        id: "piped-wireway",
        kind: "piped",
      },
      {
        baseUrl: "https://yt.omada.cafe",
        id: "invidious-omada",
        kind: "invidious",
      },
      {
        baseUrl: "https://invidious.nikkosphere.com",
        id: "invidious-nikkosphere",
        kind: "invidious",
      },
      {
        baseUrl: "https://yt.chocolatemoo53.com",
        id: "invidious-chocolatemoo",
        kind: "invidious",
        mediaRedirectOrigins: [
          "https://yt.chocolatemoo53.com",
          "https://yt-comp1.chocolatemoo53.com",
          "https://yt-comp2.chocolatemoo53.com",
          "https://yt-comp3.chocolatemoo53.com",
          "https://yt-comp4.chocolatemoo53.com",
          "https://yt-comp5.chocolatemoo53.com",
          "https://yt-comp6.chocolatemoo53.com",
        ],
      },
      {
        baseUrl: "https://y.com.sb",
        id: "invidious-y-com-sb",
        kind: "invidious",
      },
    ]);
    expect(
      createCuratedYouTubeClient().providers.map(({ id, kind }) => ({
        id,
        kind,
      }))
    ).toEqual([
      { id: "piped-wireway", kind: "piped" },
      { id: "invidious-omada", kind: "invidious" },
      { id: "invidious-nikkosphere", kind: "invidious" },
      { id: "invidious-chocolatemoo", kind: "invidious" },
      { id: "invidious-y-com-sb", kind: "invidious" },
    ]);
  });

  test("fails closed when no curated provider remains", () => {
    expect(() => createCuratedYouTubeClient([])).toThrow(
      YouTubeProviderUnavailableError
    );
  });

  test("falls back to Chocolatemoo and returns its verified companion URL", async () => {
    const hosts: string[] = [];
    const companionUrl = "https://yt-comp4.chocolatemoo53.com/videoplayback";
    const fetchImpl = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      hosts.push(url.host);
      if (url.host !== "yt.chocolatemoo53.com") {
        return Promise.resolve(new Response("unavailable", { status: 503 }));
      }
      if (new Headers(init?.headers).has("Range")) {
        if (init?.redirect !== "follow") {
          return Promise.reject(new TypeError("Unexpected redirect"));
        }
        const response = new Response(new Uint8Array([1]), {
          headers: {
            "Content-Length": "65536",
            "Content-Type": "audio/webm",
          },
          status: 206,
        });
        Object.defineProperty(response, "url", { value: companionUrl });
        return Promise.resolve(response);
      }
      expect(init?.redirect).toBe("error");
      return Promise.resolve(
        Response.json({
          adaptiveFormats: [
            {
              bitrate: "128000",
              type: "audio/webm",
              url: "/videoplayback",
            },
          ],
          author: "Artist",
          lengthSeconds: 180,
          liveNow: false,
          title: "Track",
          videoId: "abcdefghijk",
          videoThumbnails: [],
        })
      );
    });
    const client = createCuratedYouTubeClient(CURATED_YOUTUBE_PROVIDERS, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      client.resolveItem("https://youtube.com/watch?v=abcdefghijk")
    ).resolves.toMatchObject({
      metadata: { streamUrl: companionUrl },
      streamUrl: companionUrl,
    });
    expect(hosts).toEqual([
      "pipedapi.wireway.ch",
      "yt.omada.cafe",
      "invidious.nikkosphere.com",
      "yt.chocolatemoo53.com",
      "yt.chocolatemoo53.com",
    ]);
  });

  test("bounds the complete failover operation", async () => {
    const fetchImpl = mock((_input: RequestInfo | URL, init?: RequestInit) =>
      pendingUntilAborted(init)
    );
    const client = createCuratedYouTubeClient(
      [
        { baseUrl: "https://first.example", id: "first", kind: "piped" },
        { baseUrl: "https://second.example", id: "second", kind: "piped" },
      ],
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        operationTimeoutMs: 10,
        timeoutMs: 1000,
        verifyMedia: false,
      }
    );

    await expect(client.search("ambient", "songs")).rejects.toThrow(
      "YouTube provider pool timed out"
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("gives every provider a turn during two-stage resolution", async () => {
    const requests: string[] = [];
    const providers = [1, 2, 3, 4, 5].map((index) => ({
      baseUrl: `https://provider-${index}.example`,
      id: `provider-${index}`,
      kind: "piped" as const,
    }));
    const fetchImpl = mock(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/streams/")) {
          const providerHost = new URL(url).host;
          const providerIndex = providerHost.split("-")[1]?.split(".")[0];
          return Promise.resolve(
            Response.json({
              audioStreams: [
                {
                  bitrate: 128_000,
                  codec: "opus",
                  mimeType: "audio/webm",
                  url: `https://media-${providerIndex}.example.com/audio.webm`,
                },
              ],
              duration: 125,
              livestream: false,
              thumbnailUrl: "https://i.ytimg.com/vi/abcdefghijk/default.jpg",
              title: "Track",
              uploader: "Artist",
            })
          );
        }
        return pendingUntilAborted(init);
      }
    );
    const client = createCuratedYouTubeClient(providers, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      operationTimeoutMs: 100,
      timeoutMs: 10,
    });

    await expect(client.resolveStream("abcdefghijk")).rejects.toThrow(
      "Every configured YouTube provider failed"
    );
    expect(requests.filter((url) => url.includes("/streams/"))).toHaveLength(5);
    expect(requests.filter((url) => url.includes("media-"))).toHaveLength(5);
  });

  test("rejects an invalid pool timeout", () => {
    expect(() =>
      createCuratedYouTubeClient(CURATED_YOUTUBE_PROVIDERS, {
        operationTimeoutMs: 0,
      })
    ).toThrow("YouTube provider pool timeout is invalid");
  });

  // RADIO-25: synthetic browser pool outage (HTTP 500 + Failed to fetch).
  test("aggregates curated resolveItem failures across HTTP 500 and fetch errors", async () => {
    const hosts = [
      "provider-1.example",
      "provider-2.example",
      "provider-3.example",
      "provider-4.example",
    ] as const;
    const fetchImpl = mock((input: RequestInfo | URL) => {
      const { host } = new URL(String(input));
      if (host === hosts[0] || host === hosts[2]) {
        return Promise.resolve(
          new Response("upstream unavailable", { status: 500 })
        );
      }
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    const client = createCuratedYouTubeClient(
      hosts.map((host, index) => ({
        baseUrl: `https://${host}`,
        id: `provider-${index + 1}`,
        kind: index === 0 ? ("piped" as const) : ("invidious" as const),
      })),
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        verifyMedia: false,
      }
    );

    await expect(
      client.resolveItem("https://youtube.com/watch?v=abcdefghijk")
    ).rejects.toMatchObject({
      errors: [
        { code: "http", providerId: "provider-1", status: 500 },
        { code: "network-or-cors", providerId: "provider-2" },
        { code: "http", providerId: "provider-3", status: 500 },
        { code: "network-or-cors", providerId: "provider-4" },
      ],
      message: "Every configured YouTube provider failed",
      name: "YouTubeProviderAggregateError",
    });
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  test("searches and resolves through a curated browser provider", async () => {
    const fetchImpl = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search?")) {
        return Promise.resolve(
          Response.json({
            items: [
              {
                duration: 125,
                thumbnail: "https://media.example/thumb.jpg",
                title: "Browser Track",
                type: "stream",
                uploaderName: "Browser Artist",
                url: "/watch?v=abcdefghijk",
                views: 1200,
              },
            ],
          })
        );
      }
      if (url.endsWith("/streams/abcdefghijk")) {
        return Promise.resolve(
          Response.json({
            audioStreams: [
              {
                bitrate: 128_000,
                codec: "opus",
                mimeType: "audio/webm",
                url: "https://media.example/audio.webm",
              },
            ],
            duration: 125,
            livestream: false,
            thumbnailUrl: "https://media.example/thumb.jpg",
            title: "Browser Track",
            uploader: "Browser Artist",
          })
        );
      }
      return Promise.reject(new Error(`Unexpected provider request: ${url}`));
    });
    const client = createCuratedYouTubeClient(
      [{ baseUrl: "https://piped.example", id: "piped", kind: "piped" }],
      { fetchImpl: fetchImpl as unknown as typeof fetch, verifyMedia: false }
    );

    await expect(client.search("ambient", "songs")).resolves.toHaveLength(1);
    await expect(client.resolveStream("abcdefghijk")).resolves.toBe(
      "https://media.example/audio.webm"
    );
  });
});
