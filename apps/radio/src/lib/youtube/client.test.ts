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
      { id: "invidious-y-com-sb", kind: "invidious" },
    ]);
  });

  test("fails closed when no curated provider remains", () => {
    expect(() => createCuratedYouTubeClient([])).toThrow(
      YouTubeProviderUnavailableError
    );
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
    const providers = [1, 2, 3, 4].map((index) => ({
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
    expect(requests.filter((url) => url.includes("/streams/"))).toHaveLength(4);
    expect(requests.filter((url) => url.includes("media-"))).toHaveLength(4);
  });

  test("rejects an invalid pool timeout", () => {
    expect(() =>
      createCuratedYouTubeClient(CURATED_YOUTUBE_PROVIDERS, {
        operationTimeoutMs: 0,
      })
    ).toThrow("YouTube provider pool timeout is invalid");
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
