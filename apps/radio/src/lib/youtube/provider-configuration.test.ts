import { describe, expect, test } from "bun:test";
import {
  addVerifiedYouTubeProviderService,
  clearYouTubeProviderConfiguration,
  getYouTubeProviderConfiguration,
  MAX_YOUTUBE_PROVIDER_SERVICES,
  removeYouTubeProviderService,
  reorderYouTubeProviderServices,
  resetYouTubeProviderConfiguration,
  setYouTubeProviderServiceEnabled,
  YOUTUBE_PROVIDER_STORAGE_KEY,
  type YouTubeProviderConfiguration,
  YouTubeProviderConfigurationError,
} from "./provider-configuration";

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

const readyFetch = ((input: URL | RequestInfo) =>
  Promise.resolve(
    String(input).endsWith("/api/v1/stats")
      ? Response.json({ software: { name: "invidious" } })
      : new Response("OK")
  )) as typeof fetch;

describe("YouTube provider configuration", () => {
  test("falls back safely when dedicated storage is empty or malformed", () => {
    const storage = new MemoryStorage();
    const empty: YouTubeProviderConfiguration = { services: [], version: 1 };

    expect(getYouTubeProviderConfiguration(storage)).toEqual(empty);
    storage.setItem(YOUTUBE_PROVIDER_STORAGE_KEY, "not-json");
    expect(getYouTubeProviderConfiguration(storage)).toEqual(empty);
    storage.setItem(
      YOUTUBE_PROVIDER_STORAGE_KEY,
      JSON.stringify({ services: [{ kind: "unknown" }], version: 1 })
    );
    expect(getYouTubeProviderConfiguration(storage)).toEqual(empty);
  });

  test("verifies, normalizes, and atomically persists providers", async () => {
    const storage = new MemoryStorage();
    await addVerifiedYouTubeProviderService(
      {
        baseUrl: "https://invidious.example/api///",
        kind: "invidious",
        name: "  Primary  ",
      },
      { fetchImpl: readyFetch, storage }
    );
    const configuration = await addVerifiedYouTubeProviderService(
      {
        baseUrl: "http://localhost:8080/",
        enabled: false,
        id: "local-piped",
        kind: "piped",
      },
      { fetchImpl: readyFetch, storage }
    );

    expect(configuration.services).toEqual([
      {
        baseUrl: "https://invidious.example/api",
        enabled: true,
        id: "invidious:invidious.example/api",
        kind: "invidious",
        name: "Primary",
      },
      {
        baseUrl: "http://localhost:8080",
        enabled: false,
        id: "local-piped",
        kind: "piped",
        name: "localhost:8080",
      },
    ]);
    expect(getYouTubeProviderConfiguration(storage)).toEqual(configuration);
  });

  test("never persists an unverified provider", async () => {
    const storage = new MemoryStorage();

    await expect(
      addVerifiedYouTubeProviderService(
        { baseUrl: "https://offline.example", kind: "piped" },
        {
          fetchImpl: (() =>
            Promise.reject(new Error("offline"))) as unknown as typeof fetch,
          storage,
        }
      )
    ).rejects.toThrow();
    expect(storage.getItem(YOUTUBE_PROVIDER_STORAGE_KEY)).toBeNull();
  });

  test("rejects unsafe URLs, duplicates, and overflow before probing", async () => {
    const storage = new MemoryStorage();
    let fetchCalls = 0;
    const fetchImpl = ((input: URL | RequestInfo) => {
      fetchCalls += 1;
      return readyFetch(input);
    }) as typeof fetch;

    for (const baseUrl of [
      "http://invidious.example",
      "https://user:secret@invidious.example",
      "https://invidious.example?token=secret",
      "https://invidious.example#fragment",
    ]) {
      await expect(
        addVerifiedYouTubeProviderService(
          { baseUrl, kind: "invidious" },
          { fetchImpl, storage }
        )
      ).rejects.toBeInstanceOf(YouTubeProviderConfigurationError);
    }
    expect(fetchCalls).toBe(0);

    await addVerifiedYouTubeProviderService(
      { baseUrl: "https://piped-0.example", id: "one", kind: "piped" },
      { fetchImpl, storage }
    );
    await expect(
      addVerifiedYouTubeProviderService(
        { baseUrl: "https://piped-0.example/", id: "two", kind: "piped" },
        { fetchImpl, storage }
      )
    ).rejects.toThrow("endpoint is already configured");
    for (let index = 1; index < MAX_YOUTUBE_PROVIDER_SERVICES; index += 1) {
      await addVerifiedYouTubeProviderService(
        { baseUrl: `https://piped-${index}.example`, kind: "piped" },
        { fetchImpl, storage }
      );
    }
    await expect(
      addVerifiedYouTubeProviderService(
        { baseUrl: "https://overflow.example", kind: "piped" },
        { fetchImpl, storage }
      )
    ).rejects.toThrow(`At most ${MAX_YOUTUBE_PROVIDER_SERVICES}`);
    expect(fetchCalls).toBe(MAX_YOUTUBE_PROVIDER_SERVICES);
  });

  test("toggles, reorders, and removes verified services by stable ID", async () => {
    const storage = new MemoryStorage();
    await addVerifiedYouTubeProviderService(
      {
        baseUrl: "https://one.example",
        id: "one",
        kind: "invidious",
      },
      { fetchImpl: readyFetch, storage }
    );
    await addVerifiedYouTubeProviderService(
      { baseUrl: "https://two.example", id: "two", kind: "piped" },
      { fetchImpl: readyFetch, storage }
    );

    expect(
      setYouTubeProviderServiceEnabled("one", false, storage).services[0]
        ?.enabled
    ).toBe(false);
    expect(
      reorderYouTubeProviderServices(["two", "one"], storage).services.map(
        ({ id }) => id
      )
    ).toEqual(["two", "one"]);
    expect(() => reorderYouTubeProviderServices(["one"], storage)).toThrow(
      "include every configured provider once"
    );
    expect(
      removeYouTubeProviderService("two", storage).services.map(({ id }) => id)
    ).toEqual(["one"]);
  });

  test("probes Invidious and Piped adapters without credentials", async () => {
    const storage = new MemoryStorage();
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const fetchImpl = ((input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ init, url: String(input) });
      return readyFetch(input);
    }) as typeof fetch;

    await addVerifiedYouTubeProviderService(
      {
        baseUrl: "https://invidious.example",
        id: "primary",
        kind: "invidious",
      },
      { fetchImpl, storage }
    );
    await addVerifiedYouTubeProviderService(
      {
        baseUrl: "https://piped.example/api",
        id: "fallback",
        kind: "piped",
      },
      { fetchImpl, storage }
    );

    expect(requests.map(({ url }) => url)).toEqual([
      "https://invidious.example/api/v1/stats",
      "https://piped.example/api/healthcheck",
    ]);
    for (const { init } of requests) {
      expect(init?.credentials).toBe("omit");
      expect(init?.referrerPolicy).toBe("no-referrer");
    }
  });

  test("merges a verified add into the latest stored state", async () => {
    const storage = new MemoryStorage();
    await addVerifiedYouTubeProviderService(
      { baseUrl: "https://one.example", id: "one", kind: "piped" },
      { fetchImpl: readyFetch, storage }
    );

    let finishProbe: ((response: Response) => void) | undefined;
    const pending = addVerifiedYouTubeProviderService(
      { baseUrl: "https://pending.example", id: "pending", kind: "piped" },
      {
        fetchImpl: (() =>
          new Promise<Response>((resolve) => {
            finishProbe = resolve;
          })) as unknown as typeof fetch,
        storage,
      }
    );
    setYouTubeProviderServiceEnabled("one", false, storage);
    finishProbe?.(new Response("OK"));

    expect(
      (await pending).services.map(({ id, enabled }) => ({ id, enabled }))
    ).toEqual([
      { enabled: false, id: "one" },
      { enabled: true, id: "pending" },
    ]);
  });

  test("clears and resets only the YouTube provider key", async () => {
    const storage = new MemoryStorage();
    storage.setItem("unrelated", "keep");
    await addVerifiedYouTubeProviderService(
      { baseUrl: "https://piped.example", kind: "piped" },
      { fetchImpl: readyFetch, storage }
    );

    expect(resetYouTubeProviderConfiguration(storage)).toEqual({
      services: [],
      version: 1,
    });
    expect(storage.getItem(YOUTUBE_PROVIDER_STORAGE_KEY)).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");

    storage.setItem(YOUTUBE_PROVIDER_STORAGE_KEY, "stale");
    clearYouTubeProviderConfiguration(storage);
    expect(storage.getItem(YOUTUBE_PROVIDER_STORAGE_KEY)).toBeNull();
  });
});
