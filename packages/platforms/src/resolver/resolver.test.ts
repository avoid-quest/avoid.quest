import { describe, expect, mock, test } from "bun:test";
import { createResolverBroker } from "./broker";
import { ResolverAdapterError, ResolverAggregateError } from "./errors";
import { createHttpResolverAdapter } from "./http-adapter";
import {
  isResolverCapability,
  RESOLVER_CAPABILITIES,
  type ResolverAdapter,
  type ResolverManifest,
  type ResolverProvider,
  type ResolverResolution,
  type ResolverResolveRequest,
  type ResolverSearchRequest,
  type ResolverSearchResultMap,
} from "./types";

const DEFAULT_MANIFEST = {
  capabilities: RESOLVER_CAPABILITIES,
  name: "Fixture Resolver",
  protocol: "avoid-radio-resolver",
  version: 1,
} as const satisfies ResolverManifest;

function json(value: unknown, init?: ResponseInit): Response {
  return Response.json(value, init);
}

function sequencedFetch(
  operationResponse: Response | (() => Response),
  manifest: unknown = DEFAULT_MANIFEST
) {
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  const fetchImpl = mock((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ init, url: String(input) });
    if (String(input).includes("/.well-known/")) {
      return Promise.resolve(json(manifest));
    }
    return Promise.resolve(
      typeof operationResponse === "function"
        ? operationResponse()
        : operationResponse.clone()
    );
  });
  return { calls, fetchImpl: fetchImpl as typeof fetch };
}

function createStubAdapter(
  id: string,
  run: (operation: "resolve" | "search") => unknown | Promise<unknown>
): ResolverAdapter {
  return {
    id,
    probe: async () => DEFAULT_MANIFEST,
    resolve: async <P extends ResolverProvider>(
      _request: ResolverResolveRequest<P>
    ) => (await run("resolve")) as ResolverResolution<P>,
    search: async <P extends ResolverProvider>(
      _request: ResolverSearchRequest<P>
    ) => (await run("search")) as ResolverSearchResultMap[P],
  };
}

describe("resolver manifest and configuration", () => {
  test("exports the complete runtime capability allowlist", () => {
    expect(RESOLVER_CAPABILITIES).toHaveLength(6);
    expect(isResolverCapability("bandcamp:search")).toBe(true);
    expect(isResolverCapability("youtube:search")).toBe(false);
  });

  test("probes anonymously with an unbound fetch receiver", async () => {
    let receiver: unknown = null;
    let request: { init?: RequestInit; url: string } | undefined;
    const fetchImpl = function (
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit
    ) {
      receiver = this;
      request = { init, url: String(input) };
      return Promise.resolve(json(DEFAULT_MANIFEST));
    };
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test/instance/",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(adapter.probe()).resolves.toEqual(DEFAULT_MANIFEST);
    expect(receiver).toBeUndefined();
    expect(request?.url).toBe(
      "https://resolver.test/instance/.well-known/avoid-radio-resolver.json"
    );
    expect(request?.init).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      method: "GET",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  });

  test.each([
    "http://resolver.test",
    "ftp://resolver.test",
    "https://user:pass@resolver.test",
    "https://resolver.test?token=secret",
    "https://resolver.test#fragment",
  ])("rejects unsafe resolver configuration: %s", (baseUrl) => {
    expect(() => createHttpResolverAdapter({ baseUrl })).toThrow(
      ResolverAdapterError
    );
    try {
      createHttpResolverAdapter({ baseUrl });
    } catch (error) {
      expect(error).toMatchObject({
        code: "invalid-configuration",
        retryable: false,
      });
    }
  });

  test("allows HTTP only for localhost development", () => {
    expect(
      createHttpResolverAdapter({ baseUrl: "http://127.0.0.1:4100" }).id
    ).toBe("resolver:127.0.0.1:4100");
    expect(
      createHttpResolverAdapter({ baseUrl: "http://localhost:4100" }).id
    ).toBe("resolver:localhost:4100");
  });

  test.each([
    { ...DEFAULT_MANIFEST, protocol: "something-else" },
    { ...DEFAULT_MANIFEST, version: 2 },
    { ...DEFAULT_MANIFEST, name: "" },
    { ...DEFAULT_MANIFEST, capabilities: ["youtube:search"] },
    {
      ...DEFAULT_MANIFEST,
      capabilities: ["bandcamp:search", "bandcamp:search"],
    },
  ])("rejects an invalid manifest schema", async (manifest) => {
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: mock(() => Promise.resolve(json(manifest))) as typeof fetch,
    });
    await expect(adapter.probe()).rejects.toMatchObject({
      code: "invalid-schema",
    });
  });

  test("caches only a successful manifest", async () => {
    const fetchImpl = mock(() => Promise.resolve(json(DEFAULT_MANIFEST)));
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await adapter.probe();
    await adapter.probe();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("resolver search protocol", () => {
  test("preserves Bandcamp canonical URLs and sends its filter", async () => {
    const result = {
      albumTitle: "Album",
      artist: "Artist",
      id: "123",
      thumbnail: "https://f4.bcbits.com/img/a1.jpg",
      title: "Track",
      type: "track",
      url: "https://artist.bandcamp.com/track/a?from=discover",
    } as const;
    const fixture = sequencedFetch(json({ results: [result] }));
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: fixture.fetchImpl,
    });

    await expect(
      adapter.search({ provider: "bandcamp", query: "ambient", filter: "t" })
    ).resolves.toEqual([result]);
    expect(fixture.calls[1]?.url).toBe("https://resolver.test/api/search");
    expect(fixture.calls[1]?.init).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      method: "POST",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(JSON.parse(String(fixture.calls[1]?.init?.body))).toEqual({
      filter: "t",
      provider: "bandcamp",
      query: "ambient",
    });
  });

  test("validates and returns raw SoundCloud results", async () => {
    const result = {
      artist: "Artist",
      duration: 125,
      id: "42",
      thumbnail: "https://i1.sndcdn.com/artworks.jpg",
      title: "Track",
      url: "https://soundcloud.com/artist/track",
    };
    const fixture = sequencedFetch(json({ results: [result] }));
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: fixture.fetchImpl,
    });
    await expect(
      adapter.search({ provider: "soundcloud", query: "ambient" })
    ).resolves.toEqual([result]);
  });

  test("validates and returns raw Radio Garden results", async () => {
    const result = {
      channelId: "abc123",
      countryTitle: "United Kingdom",
      placeTitle: "London",
      subtitle: "London, UK",
      title: "NTS Radio",
      url: "https://radio.garden/listen/nts/abc123",
      website: "https://www.nts.live",
    };
    const fixture = sequencedFetch(json({ results: [result] }));
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: fixture.fetchImpl,
    });
    await expect(
      adapter.search({ provider: "radiogarden", query: "NTS" })
    ).resolves.toEqual([result]);
  });

  test.each([
    {
      provider: "bandcamp" as const,
      results: [
        {
          artist: "Artist",
          id: "1",
          title: "Track",
          type: "video",
          url: "https://artist.bandcamp.com/track/a",
        },
      ],
    },
    {
      provider: "soundcloud" as const,
      results: [
        {
          artist: "Artist",
          duration: "125",
          id: "1",
          title: "Track",
          url: "https://soundcloud.com/a/b",
        },
      ],
    },
    {
      provider: "radiogarden" as const,
      results: [
        {
          channelId: "id",
          countryTitle: "UK",
          placeTitle: "London",
          title: "Station",
          url: "javascript:alert(1)",
        },
      ],
    },
  ])("rejects invalid $provider search schemas", async (fixture) => {
    const requests = sequencedFetch(json({ results: fixture.results }));
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: requests.fetchImpl,
    });
    await expect(
      adapter.search({ provider: fixture.provider, query: "query" })
    ).rejects.toMatchObject({ code: "invalid-schema" });
  });

  test("rejects unsupported capabilities before the operation request", async () => {
    const fixture = sequencedFetch(json({ results: [] }), {
      ...DEFAULT_MANIFEST,
      capabilities: ["bandcamp:resolve"],
    });
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: fixture.fetchImpl,
    });
    await expect(
      adapter.search({ provider: "bandcamp", query: "ambient" })
    ).rejects.toMatchObject({ code: "unsupported-capability" });
    expect(fixture.calls).toHaveLength(1);
  });

  test("rejects invalid search input without making a request", async () => {
    const fetchImpl = mock(() => Promise.resolve(json(DEFAULT_MANIFEST)));
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(
      adapter.search({ provider: "soundcloud", query: "  " })
    ).rejects.toMatchObject({ code: "invalid-input", retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("resolver resolution protocol", () => {
  test("preserves a Bandcamp collection and its canonical stream URLs", async () => {
    const result = {
      expiresAt: "2027-01-02T03:04:05.000Z",
      metadata: {
        artist: "Artist",
        itemType: "album",
        name: "Album",
        platform: "bandcamp",
        trackCount: 2,
        tracks: [
          {
            duration: 120,
            format: "progressive",
            name: "One",
            streamUrl: "https://t4.bcbits.com/stream/one?token=signed",
            trackNumber: 1,
          },
          {
            duration: 140,
            format: "hls",
            name: "Two",
            streamUrl: "https://t4.bcbits.com/stream/two?token=signed",
            trackNumber: 2,
          },
        ],
        url: "https://artist.bandcamp.com/album/album",
      },
      resolverId: "remote-controlled",
      streamUrl: "https://t4.bcbits.com/stream/one?token=signed",
    } as const;
    const expected = { ...result, resolverId: "resolver:resolver.test" };
    const fixture = sequencedFetch(json(result));
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: fixture.fetchImpl,
    });

    await expect(
      adapter.resolve({
        provider: "bandcamp",
        url: "https://artist.bandcamp.com/album/album?from=search",
      })
    ).resolves.toEqual(expected);
    expect(JSON.parse(String(fixture.calls[1]?.init?.body))).toEqual({
      provider: "bandcamp",
      url: "https://artist.bandcamp.com/album/album?from=search",
    });
  });

  test("preserves a SoundCloud playlist collection", async () => {
    const result = {
      metadata: {
        artist: "Artist",
        itemType: "playlist",
        name: "Set",
        platform: "soundcloud",
        trackCount: 1,
        tracks: [
          {
            duration: 180,
            format: "hls",
            name: "Track",
            streamUrl: "https://cf-hls-media.sndcdn.com/extensionless",
          },
        ],
        url: "https://soundcloud.com/artist/sets/set",
      },
      streamUrl: "https://cf-hls-media.sndcdn.com/extensionless",
    } as const;
    const expected = { ...result, resolverId: "resolver:resolver.test" };
    const fixture = sequencedFetch(json(result));
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: fixture.fetchImpl,
    });
    await expect(
      adapter.resolve({
        provider: "soundcloud",
        url: "https://soundcloud.com/artist/sets/set",
      })
    ).resolves.toEqual(expected);
  });

  test("validates a Radio Garden channel resolution", async () => {
    const result = {
      metadata: {
        channelId: "abc123",
        countryTitle: "United Kingdom",
        itemType: "channel",
        name: "NTS Radio",
        placeTitle: "London",
        platform: "radiogarden",
        url: "https://radio.garden/listen/nts/abc123",
      },
      streamUrl: "https://stream-relay.example/nts.mp3",
    } as const;
    const expected = { ...result, resolverId: "resolver:resolver.test" };
    const fixture = sequencedFetch(json(result));
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: fixture.fetchImpl,
    });
    await expect(
      adapter.resolve({
        provider: "radiogarden",
        url: "https://radio.garden/listen/nts/abc123",
      })
    ).resolves.toEqual(expected);
  });

  test("preserves an explicit resolver stream format", async () => {
    const result = {
      format: "hls",
      metadata: {
        channelId: "abc123",
        itemType: "channel",
        platform: "radiogarden",
        url: "https://radio.garden/listen/nts/abc123",
      },
      streamUrl: "https://stream.example/extensionless",
    } as const;
    const fixture = sequencedFetch(json(result));
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: fixture.fetchImpl,
    });

    await expect(
      adapter.resolve({
        provider: "radiogarden",
        url: "https://radio.garden/listen/nts/abc123",
      })
    ).resolves.toEqual({ ...result, resolverId: "resolver:resolver.test" });
  });

  test.each([
    {
      label: "top-level stream",
      mutate: (result: Record<string, any>) => {
        result.streamUrl = "http://127.0.0.1:8080/audio";
      },
    },
    {
      label: "canonical metadata",
      mutate: (result: Record<string, any>) => {
        result.metadata.url = "http://127.0.0.1/private";
      },
    },
    {
      label: "nested track stream",
      mutate: (result: Record<string, any>) => {
        result.metadata.tracks[0].streamUrl = "http://10.0.0.1/audio";
      },
    },
    {
      label: "nested track format",
      mutate: (result: Record<string, any>) => {
        result.metadata.tracks[0].format = "dash";
      },
    },
  ])("rejects an internal $label from a public resolver", async ({
    mutate,
  }) => {
    const result: Record<string, any> = {
      metadata: {
        itemType: "playlist",
        platform: "soundcloud",
        tracks: [
          {
            name: "Track",
            streamUrl: "https://media.example/audio",
          },
        ],
        url: "https://soundcloud.com/artist/set",
      },
      streamUrl: "https://media.example/audio",
    };
    mutate(result);
    const fixture = sequencedFetch(json(result));
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: fixture.fetchImpl,
    });

    await expect(
      adapter.resolve({
        provider: "soundcloud",
        url: "https://soundcloud.com/artist/set",
      })
    ).rejects.toMatchObject({ code: "invalid-schema" });
  });

  test("allows loopback response URLs only for a loopback resolver", async () => {
    const result = {
      metadata: {
        itemType: "playlist",
        platform: "soundcloud",
        tracks: [
          {
            name: "Track",
            streamUrl: "http://127.0.0.1:4100/audio/track",
          },
        ],
        url: "http://localhost:4100/canonical/track",
      },
      streamUrl: "http://127.0.0.1:4100/audio/track",
    } as const;
    const fixture = sequencedFetch(json(result));
    const adapter = createHttpResolverAdapter({
      baseUrl: "http://localhost:4100",
      fetchImpl: fixture.fetchImpl,
    });

    await expect(
      adapter.resolve({
        provider: "soundcloud",
        url: "https://soundcloud.com/artist/set",
      })
    ).resolves.toEqual({ ...result, resolverId: "resolver:localhost:4100" });
  });

  test.each([
    {
      metadata: {
        itemType: "track",
        platform: "soundcloud",
        url: "https://soundcloud.com/a/b",
      },
      streamUrl: "https://audio.test/file.mp3",
    },
    {
      expiresAt: "tomorrow-ish",
      metadata: {
        itemType: "track",
        platform: "bandcamp",
        url: "https://artist.bandcamp.com/track/a",
      },
      streamUrl: "https://audio.test/file.mp3",
    },
    {
      metadata: {
        itemType: "track",
        platform: "bandcamp",
        url: "https://artist.bandcamp.com/track/a",
      },
      streamUrl: "data:audio/mp3;base64,AA==",
    },
    {
      format: "dash",
      metadata: {
        itemType: "track",
        platform: "bandcamp",
        url: "https://artist.bandcamp.com/track/a",
      },
      streamUrl: "https://audio.test/file.mp3",
    },
  ])("rejects invalid provider resolution schemas", async (result) => {
    const fixture = sequencedFetch(json(result));
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: fixture.fetchImpl,
    });
    await expect(
      adapter.resolve({
        provider: "bandcamp",
        url: "https://artist.bandcamp.com/track/a",
      })
    ).rejects.toMatchObject({ code: "invalid-schema" });
  });

  test("rejects invalid resolve URLs before making a request", async () => {
    const fetchImpl = mock(() => Promise.resolve(json(DEFAULT_MANIFEST)));
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(
      adapter.resolve({ provider: "bandcamp", url: "javascript:alert(1)" })
    ).rejects.toMatchObject({ code: "invalid-input", retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("resolver request error classification", () => {
  test.each([
    {
      expected: { code: "http", status: 503 },
      response: new Response("down", { status: 503 }),
    },
    {
      expected: { code: "unexpected-content-type" },
      response: new Response("<!doctype html>", {
        headers: { "Content-Type": "text/html" },
      }),
    },
    {
      expected: { code: "invalid-json" },
      response: new Response("{broken", {
        headers: { "Content-Type": "application/json" },
      }),
    },
  ])("classifies $expected.code responses", async ({ expected, response }) => {
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: mock(() => Promise.resolve(response)) as typeof fetch,
    });
    await expect(adapter.probe()).rejects.toMatchObject(expected);
  });

  test("accepts structured JSON content types", async () => {
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: mock(() =>
        Promise.resolve(
          new Response(JSON.stringify(DEFAULT_MANIFEST), {
            headers: {
              "Content-Type": "application/problem+json; charset=utf-8",
            },
          })
        )
      ) as typeof fetch,
    });
    await expect(adapter.probe()).resolves.toEqual(DEFAULT_MANIFEST);
  });

  test("rejects an oversized response while streaming", async () => {
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: mock(() =>
        Promise.resolve(json(DEFAULT_MANIFEST))
      ) as typeof fetch,
      maxResponseBytes: 16,
    });
    await expect(adapter.probe()).rejects.toMatchObject({
      code: "response-too-large",
    });
  });

  test("classifies fetch rejection as network-or-CORS", async () => {
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: mock(() =>
        Promise.reject(new TypeError("Failed to fetch https://secret.test"))
      ) as typeof fetch,
    });
    await expect(adapter.probe()).rejects.toMatchObject({
      code: "network-or-cors",
    });
  });

  test("distinguishes timeout from network failure", async () => {
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: mock(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
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

  test("classifies caller cancellation as a non-retryable abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = createHttpResolverAdapter({
      baseUrl: "https://resolver.test",
      fetchImpl: mock((_input: RequestInfo | URL, init?: RequestInit) =>
        Promise.reject(init?.signal?.reason)
      ) as typeof fetch,
    });
    await expect(adapter.probe(controller.signal)).rejects.toMatchObject({
      code: "aborted",
      retryable: false,
    });
  });
});

describe("resolver broker failover", () => {
  test("tries adapters in order and returns the first success", async () => {
    const order: string[] = [];
    const first = createStubAdapter("first", () => {
      order.push("first");
      throw new ResolverAdapterError("outage", {
        adapterId: "first",
        code: "http",
        status: 503,
      });
    });
    const result = {
      artist: "Artist",
      duration: 120,
      id: "1",
      title: "Track",
      url: "https://soundcloud.com/artist/track",
    };
    const second = createStubAdapter("second", () => {
      order.push("second");
      return [result];
    });
    const third = createStubAdapter("third", () => {
      order.push("third");
      return [];
    });
    const broker = createResolverBroker([first, second, third]);

    await expect(
      broker.search({ provider: "soundcloud", query: "ambient" })
    ).resolves.toEqual([result]);
    expect(order).toEqual(["first", "second"]);
  });

  test("returns only sanitized attempt diagnostics after total failure", async () => {
    const first = createStubAdapter("first<script>", () => {
      throw new Error("secret token and upstream URL");
    });
    const second = createStubAdapter("second", () => {
      throw new ResolverAdapterError("private upstream response body", {
        adapterId: "ignored-private-id",
        code: "http",
        status: 502,
      });
    });
    const broker = createResolverBroker([first, second]);

    try {
      await broker.search({ provider: "radiogarden", query: "NTS" });
      throw new Error("Expected broker failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ResolverAggregateError);
      expect(error).toMatchObject({
        attempts: [
          { adapterId: "first_script_", code: "network-or-cors" },
          { adapterId: "second", code: "http", status: 502 },
        ],
        operation: "search",
        provider: "radiogarden",
      });
      expect(JSON.stringify(error)).not.toContain("secret token");
      expect(JSON.stringify(error)).not.toContain("private upstream");
    }
  });

  test("does not fail over after caller cancellation", async () => {
    let secondCalled = false;
    const first = createStubAdapter("first", () => {
      throw new ResolverAdapterError("cancelled", {
        adapterId: "first",
        code: "aborted",
        retryable: false,
      });
    });
    const second = createStubAdapter("second", () => {
      secondCalled = true;
      return [];
    });
    const broker = createResolverBroker([first, second]);

    await expect(
      broker.search({ provider: "radiogarden", query: "NTS" })
    ).rejects.toMatchObject({ code: "aborted", retryable: false });
    expect(secondCalled).toBe(false);
  });

  test("reports no attempts when no adapters are configured", async () => {
    const broker = createResolverBroker([]);
    await expect(
      broker.resolve({
        provider: "soundcloud",
        url: "https://soundcloud.com/artist/track",
      })
    ).rejects.toMatchObject({ attempts: [], operation: "resolve" });
  });

  test("validates input once before entering the adapter chain", async () => {
    let called = false;
    const broker = createResolverBroker([
      createStubAdapter("resolver", () => {
        called = true;
        return [];
      }),
    ]);
    await expect(
      broker.resolve({ provider: "radiogarden", url: "not a URL" })
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(called).toBe(false);
  });
});
