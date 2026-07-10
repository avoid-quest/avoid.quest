import { describe, expect, mock, test } from "bun:test";
import { getBandcampItem } from "@avoid.quest/platforms/bandcamp";
import type {
  ResolverCapability,
  ResolverProvider,
  ResolverSearchResultMap,
} from "@avoid.quest/platforms/resolver";
import { setCompatibilityFallbacksEnabled } from "../compatibility-fallback-policy";
import {
  APP_SERVER_RESOLVER_ID,
  createAppServerResolverAdapter,
  createConfiguredResolverBroker,
} from "./client";
import { RESOLVER_STORAGE_KEY } from "./resolver-configuration";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

type ConfiguredService = {
  baseUrl: string;
  capabilities: ResolverCapability[];
  enabled?: boolean;
  name?: string;
};

function configuredStorage(services: ConfiguredService[]): MemoryStorage {
  const storage = new MemoryStorage();
  storage.setItem(
    RESOLVER_STORAGE_KEY,
    JSON.stringify({
      services: services.map((service) => ({
        baseUrl: service.baseUrl,
        capabilities: service.capabilities,
        enabled: service.enabled ?? true,
        kind: "platform-resolver",
        name: service.name ?? service.baseUrl,
      })),
      version: 1,
    })
  );
  return storage;
}

function manifest(capabilities: ResolverCapability[]) {
  return {
    capabilities,
    name: "Live resolver",
    protocol: "avoid-radio-resolver",
    version: 1,
  };
}

const BANDCAMP_RESULT = {
  artist: "Artist",
  id: "bc-1",
  title: "Track",
  type: "track",
  url: "https://artist.bandcamp.com/track/track",
} as const;

const SOUNDCLOUD_RESULT = {
  artist: "Artist",
  duration: 125,
  id: "sc-1",
  title: "Track",
  url: "https://soundcloud.com/artist/track",
};

const RADIO_GARDEN_RESULT = {
  channelId: "abc123",
  countryTitle: "United Kingdom",
  placeTitle: "London",
  subtitle: "London, UK",
  title: "NTS Radio",
  url: "https://radio.garden/listen/nts/abc123",
};

describe("configured resolver broker", () => {
  test("keeps enabled persisted order, stable unique IDs, and app fallback last", async () => {
    const storage = configuredStorage([
      {
        baseUrl: "https://resolver.example/one",
        capabilities: ["bandcamp:search"],
        name: "One",
      },
      {
        baseUrl: "https://disabled.example",
        capabilities: ["soundcloud:search"],
        enabled: false,
        name: "Disabled",
      },
      {
        baseUrl: "https://resolver.example/two",
        capabilities: ["radiogarden:resolve"],
        name: "Two",
      },
    ]);
    const fetchImpl = mock(() =>
      Promise.resolve(
        Response.json(manifest(["bandcamp:search", "radiogarden:resolve"]))
      )
    );
    const first = createConfiguredResolverBroker({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage,
    });
    const second = createConfiguredResolverBroker({ storage });

    expect(first.adapters).toHaveLength(3);
    expect(first.adapters.map(({ id }) => id)).toEqual([
      second.adapters[0]?.id,
      second.adapters[1]?.id,
      APP_SERVER_RESOLVER_ID,
    ]);
    expect(first.adapters[0]?.id).not.toBe(first.adapters[1]?.id);
    await expect(first.adapters[0]?.probe()).resolves.toEqual({
      capabilities: ["bandcamp:search"],
      name: "One",
      protocol: "avoid-radio-resolver",
      version: 1,
    });
    await expect(first.adapters[1]?.probe()).resolves.toEqual({
      capabilities: ["radiogarden:resolve"],
      name: "Two",
      protocol: "avoid-radio-resolver",
      version: 1,
    });
  });

  test("omits the app-server resolver when compatibility fallbacks are disabled", () => {
    const storage = configuredStorage([
      {
        baseUrl: "https://resolver.example",
        capabilities: ["bandcamp:search"],
      },
    ]);

    expect(
      createConfiguredResolverBroker({ storage }).adapters.map(({ id }) => id)
    ).toContain(APP_SERVER_RESOLVER_ID);

    setCompatibilityFallbacksEnabled(false, storage);

    expect(
      createConfiguredResolverBroker({ storage }).adapters.map(({ id }) => id)
    ).not.toContain(APP_SERVER_RESOLVER_ID);
  });

  test("gates stale capabilities locally and falls back without HTTP", async () => {
    const storage = configuredStorage([
      {
        baseUrl: "https://bandcamp-only.example",
        capabilities: ["bandcamp:search"],
      },
    ]);
    const fetchImpl = mock(() => {
      throw new Error("HTTP adapter should not be called");
    });
    const serverSearch = mock(() =>
      Promise.resolve({
        data: { results: [SOUNDCLOUD_RESULT] },
        ok: true as const,
      })
    );
    const broker = createConfiguredResolverBroker({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      serverFunctions: { soundCloudSearch: serverSearch },
      storage,
    });

    await expect(
      broker.search({ provider: "soundcloud", query: "ambient" })
    ).resolves.toEqual([SOUNDCLOUD_RESULT]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(serverSearch).toHaveBeenCalledWith({ query: "ambient" });
  });

  test("uses a capable HTTP resolver before the app server", async () => {
    const storage = configuredStorage([
      {
        baseUrl: "https://resolver.example",
        capabilities: ["soundcloud:search"],
      },
    ]);
    const requests: string[] = [];
    const fetchImpl = mock((input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      return Promise.resolve(
        url.includes("/.well-known/")
          ? Response.json(manifest(["soundcloud:search"]))
          : Response.json({ results: [SOUNDCLOUD_RESULT] })
      );
    });
    const serverSearch = mock(() =>
      Promise.reject(new Error("app fallback should not run"))
    );
    const broker = createConfiguredResolverBroker({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      serverFunctions: { soundCloudSearch: serverSearch },
      storage,
    });

    await expect(
      broker.search({ provider: "soundcloud", query: "ambient" })
    ).resolves.toEqual([SOUNDCLOUD_RESULT]);
    expect(requests).toEqual([
      "https://resolver.example/.well-known/avoid-radio-resolver.json",
      "https://resolver.example/api/search",
    ]);
    expect(serverSearch).not.toHaveBeenCalled();
  });

  test("tries configured resolvers in order before app-server parity fallback", async () => {
    const storage = configuredStorage([
      {
        baseUrl: "https://one.example",
        capabilities: ["bandcamp:search"],
      },
      {
        baseUrl: "https://two.example",
        capabilities: ["bandcamp:search"],
      },
    ]);
    const order: string[] = [];
    const fetchImpl = mock((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      order.push(`${url.host}:${url.pathname}`);
      return Promise.resolve(
        url.pathname.includes(".well-known")
          ? Response.json(manifest(["bandcamp:search"]))
          : new Response("down", { status: 503 })
      );
    });
    const serverSearch = mock(() => {
      order.push("app-server:search");
      return Promise.resolve({
        data: { results: [BANDCAMP_RESULT] },
        ok: true as const,
      });
    });
    const broker = createConfiguredResolverBroker({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      serverFunctions: { bandcampSearch: serverSearch },
      storage,
    });

    await expect(
      broker.search({ provider: "bandcamp", query: "ambient", filter: "t" })
    ).resolves.toEqual([BANDCAMP_RESULT]);
    expect(order).toEqual([
      "one.example:/.well-known/avoid-radio-resolver.json",
      "one.example:/api/search",
      "two.example:/.well-known/avoid-radio-resolver.json",
      "two.example:/api/search",
      "app-server:search",
    ]);
  });
});

describe("app server resolver adapter", () => {
  test("maps all provider searches without changing filters or collections", async () => {
    const calls: Array<{ provider: ResolverProvider; value: unknown }> = [];
    const adapter = createAppServerResolverAdapter({
      bandcampSearch: (input) => {
        calls.push({ provider: "bandcamp", value: input });
        return Promise.resolve({
          data: { results: [BANDCAMP_RESULT] },
          ok: true,
        });
      },
      radioGardenSearch: (input) => {
        calls.push({ provider: "radiogarden", value: input });
        return Promise.resolve({
          data: { results: [RADIO_GARDEN_RESULT] },
          ok: true,
        });
      },
      soundCloudSearch: (input) => {
        calls.push({ provider: "soundcloud", value: input });
        return Promise.resolve({
          data: { results: [SOUNDCLOUD_RESULT] },
          ok: true,
        });
      },
    });

    await expect(
      adapter.search({ provider: "bandcamp", query: "one", filter: "a" })
    ).resolves.toEqual([BANDCAMP_RESULT]);
    await expect(
      adapter.search({ provider: "soundcloud", query: "two" })
    ).resolves.toEqual([SOUNDCLOUD_RESULT]);
    await expect(
      adapter.search({ provider: "radiogarden", query: "three" })
    ).resolves.toEqual([RADIO_GARDEN_RESULT]);
    expect(calls).toEqual([
      {
        provider: "bandcamp",
        value: { filter: "a", query: "one" },
      },
      { provider: "soundcloud", value: { query: "two" } },
      { provider: "radiogarden", value: { query: "three" } },
    ]);
  });

  test.each([
    {
      metadata: {
        itemType: "track",
        name: "Bandcamp Track",
        platform: "bandcamp",
        url: "https://artist.bandcamp.com/track/track",
      },
      provider: "bandcamp" as const,
      streamUrl: "/api/bandcamp-proxy?url=canonical",
    },
    {
      metadata: {
        itemType: "playlist",
        name: "SoundCloud Set",
        platform: "soundcloud",
        tracks: [
          {
            name: "Track",
            streamUrl: "https://cf-media.sndcdn.com/track.mp3",
          },
        ],
        url: "https://soundcloud.com/artist/sets/set",
      },
      provider: "soundcloud" as const,
      streamUrl: "/api/soundcloud-proxy?url=canonical",
    },
    {
      metadata: {
        channelId: "abc123",
        itemType: "channel",
        name: "NTS",
        platform: "radiogarden",
        url: "https://radio.garden/listen/nts/abc123",
      },
      provider: "radiogarden" as const,
      streamUrl: "https://stream.example/nts.mp3",
    },
  ])("preserves $provider resolution parity", async (fixture) => {
    const resolvePlatformItem = mock(() =>
      Promise.resolve({
        data: {
          metadata: fixture.metadata,
          streamUrl: fixture.streamUrl,
        },
        ok: true as const,
      })
    );
    const adapter = createAppServerResolverAdapter({ resolvePlatformItem });

    const resolution = await adapter.resolve({
      provider: fixture.provider,
      url: fixture.metadata.url,
    });
    expect(resolution as unknown).toEqual({
      metadata: fixture.metadata,
      resolverId: APP_SERVER_RESOLVER_ID,
      streamUrl: fixture.streamUrl,
    });
    expect(resolvePlatformItem).toHaveBeenCalledWith({
      url: fixture.metadata.url,
    });
  });

  test("accepts a produced Bandcamp album after unavailable tracks are removed", async () => {
    const url = "https://artist.bandcamp.com/album/playable-album";
    const basic = JSON.stringify({
      byArtist: { name: "Artist" },
      image: "https://f4.bcbits.com/img/album.jpg",
      name: "Playable Album",
    });
    const extra = JSON.stringify({
      trackinfo: [
        { duration: 10, title: "Unavailable", track_num: 1 },
        {
          duration: 20,
          file: {
            "mp3-128": "https://t4.bcbits.com/stream/playable/mp3-128",
          },
          title: "Playable",
          track_num: 2,
        },
      ],
    }).replaceAll('"', "&quot;");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          `<script type="application/ld+json">${basic}</script><script data-tralbum="${extra}"></script>`
        )
      )
    ) as unknown as typeof fetch;

    try {
      const produced = await getBandcampItem(url);
      if (!produced.success) {
        throw new Error(produced.error);
      }
      expect(produced.metadata.tracks).toEqual([
        {
          duration: 20,
          format: "progressive",
          name: "Playable",
          streamUrl: "https://t4.bcbits.com/stream/playable/mp3-128",
          trackNumber: 2,
        },
      ]);

      const adapter = createAppServerResolverAdapter({
        resolvePlatformItem: () =>
          Promise.resolve({ data: produced, ok: true }),
      });

      await expect(
        adapter.resolve({ provider: "bandcamp", url })
      ).resolves.toMatchObject({
        format: "progressive",
        metadata: { tracks: produced.metadata.tracks },
        streamUrl: produced.streamUrl,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("maps AppResult failures without leaking server details", async () => {
    const upstreamFailure = {
      error: {
        code: "PRIVATE_UPSTREAM_CODE",
        message: "token=secret upstream=https://private.example",
        requestId: "private-request-id",
        status: 502,
      },
      ok: false as const,
    };
    const adapter = createAppServerResolverAdapter({
      bandcampSearch: () => Promise.resolve(upstreamFailure),
    });

    try {
      await adapter.search({ provider: "bandcamp", query: "ambient" });
      throw new Error("Expected app server failure");
    } catch (error) {
      expect(error).toMatchObject({
        adapterId: APP_SERVER_RESOLVER_ID,
        code: "http",
        message: "App server resolver failed",
        status: 502,
      });
      expect(String(error)).not.toContain("secret");
      expect(JSON.stringify(error)).not.toContain("PRIVATE_UPSTREAM_CODE");
      expect(JSON.stringify(error)).not.toContain("private-request-id");
    }
  });

  test("maps thrown server details to a stable transport error", async () => {
    const adapter = createAppServerResolverAdapter({
      soundCloudSearch: () =>
        Promise.reject(new Error("token=secret https://upstream.example")),
    });
    await expect(
      adapter.search({ provider: "soundcloud", query: "ambient" })
    ).rejects.toMatchObject({
      code: "network-or-cors",
      message: "App server resolver is unavailable",
    });
  });

  test("rejects caller cancellation before invoking the server", async () => {
    const serverSearch = mock(() =>
      Promise.resolve({
        data: { results: [] as ResolverSearchResultMap["radiogarden"] },
        ok: true as const,
      })
    );
    const adapter = createAppServerResolverAdapter({
      radioGardenSearch: serverSearch,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.search({
        provider: "radiogarden",
        query: "NTS",
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ code: "aborted", retryable: false });
    expect(serverSearch).not.toHaveBeenCalled();
  });

  test("fails closed when server metadata does not match the provider", async () => {
    const adapter = createAppServerResolverAdapter({
      resolvePlatformItem: () =>
        Promise.resolve({
          data: {
            metadata: {
              itemType: "track",
              platform: "soundcloud",
              url: "https://soundcloud.com/artist/track",
            },
            streamUrl: "https://audio.example/track.mp3",
          },
          ok: true,
        }),
    });
    await expect(
      adapter.resolve({
        provider: "bandcamp",
        url: "https://artist.bandcamp.com/track/track",
      })
    ).rejects.toMatchObject({ code: "invalid-schema" });
  });

  test("rejects malformed and internal URLs throughout server metadata", async () => {
    const adapter = createAppServerResolverAdapter({
      resolvePlatformItem: () =>
        Promise.resolve({
          data: {
            metadata: {
              itemType: "playlist",
              platform: "soundcloud",
              tracks: [
                {
                  name: "Track",
                  streamUrl: "http://127.0.0.1/private-audio",
                },
              ],
              url: "https://soundcloud.com/artist/set",
            },
            streamUrl: "/api/soundcloud-proxy?url=canonical",
          },
          ok: true,
        }),
    });

    await expect(
      adapter.resolve({
        provider: "soundcloud",
        url: "https://soundcloud.com/artist/set",
      })
    ).rejects.toMatchObject({ code: "invalid-schema" });
  });

  test("applies the complete provider metadata schema to server responses", async () => {
    const adapter = createAppServerResolverAdapter({
      resolvePlatformItem: () =>
        Promise.resolve({
          data: {
            metadata: {
              duration: "not-a-number",
              itemType: "track",
              platform: "bandcamp",
              url: "https://artist.bandcamp.com/track/track",
            },
            streamUrl: "/api/bandcamp-proxy?url=canonical",
          },
          ok: true,
        }),
    });

    await expect(
      adapter.resolve({
        provider: "bandcamp",
        url: "https://artist.bandcamp.com/track/track",
      })
    ).rejects.toMatchObject({ code: "invalid-schema" });
  });

  test("accepts relative app proxies and explicit stream format", async () => {
    const adapter = createAppServerResolverAdapter({
      resolvePlatformItem: () =>
        Promise.resolve({
          data: {
            format: "progressive",
            metadata: {
              itemType: "track",
              platform: "bandcamp",
              streamUrl: "/api/bandcamp-proxy?url=canonical",
              url: "https://artist.bandcamp.com/track/track",
            },
            streamUrl: "/api/bandcamp-proxy?url=canonical",
          },
          ok: true,
        }),
    });

    await expect(
      adapter.resolve({
        provider: "bandcamp",
        url: "https://artist.bandcamp.com/track/track",
      })
    ).resolves.toEqual({
      format: "progressive",
      metadata: {
        itemType: "track",
        platform: "bandcamp",
        streamUrl: "/api/bandcamp-proxy?url=canonical",
        url: "https://artist.bandcamp.com/track/track",
      },
      resolverId: APP_SERVER_RESOLVER_ID,
      streamUrl: "/api/bandcamp-proxy?url=canonical",
    });
  });

  test.each([
    "//internal.example/audio",
    "/\\internal.example/audio",
  ])("rejects same-origin proxy lookalike %s", async (streamUrl) => {
    const adapter = createAppServerResolverAdapter({
      resolvePlatformItem: () =>
        Promise.resolve({
          data: {
            metadata: {
              itemType: "track",
              platform: "bandcamp",
              url: "https://artist.bandcamp.com/track/track",
            },
            streamUrl,
          },
          ok: true,
        }),
    });

    await expect(
      adapter.resolve({
        provider: "bandcamp",
        url: "https://artist.bandcamp.com/track/track",
      })
    ).rejects.toMatchObject({ code: "invalid-schema" });
  });

  test("advertises complete fallback parity", async () => {
    const adapter = createAppServerResolverAdapter();
    await expect(adapter.probe()).resolves.toMatchObject({
      capabilities: [
        "bandcamp:search",
        "bandcamp:resolve",
        "soundcloud:search",
        "soundcloud:resolve",
        "radiogarden:search",
        "radiogarden:resolve",
      ],
      name: "Avoid Radio app server",
    });
  });
});
