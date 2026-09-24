import { describe, expect, jest, mock, test } from "bun:test";
import {
  cacheMetadata,
  clearRadioMetadataCache,
  edgeMetadataCache,
  getCachedRadioMetadata,
  getOrSetCachedRadioMetadata,
  setCachedRadioMetadata,
} from "./cache";
import { createMetadataCacheFixture } from "./cache-test-fixture";
import type { RadioMetadataResponse } from "./types";

const success: RadioMetadataResponse = {
  data: {
    album: null,
    artist: null,
    artworkUrl: null,
    bitrate: null,
    expiresAt: 2000,
    genre: null,
    itemUrl: null,
    rawTitle: "Title",
    sampledAt: 1000,
    source: "icy",
    stationDescription: null,
    stationName: null,
    streamUrl: "https://radio.example/live",
    title: "Title",
  },
  ok: true,
};

describe("radio metadata cache", () => {
  test("expires entries", () => {
    clearRadioMetadataCache();
    setCachedRadioMetadata("a", success, 100, 1000);
    expect(getCachedRadioMetadata("a", 1099)).toEqual(success);
    expect(getCachedRadioMetadata("a", 1100)).toBeNull();
  });

  test("deduplicates in-flight retrievals", async () => {
    clearRadioMetadataCache();
    let calls = 0;
    const retrieve = async () => {
      calls += 1;
      await Promise.resolve();
      return success;
    };

    const [first, second] = await Promise.all([
      getOrSetCachedRadioMetadata("same", {
        now: () => 1000,
        retrieve,
        ttlForResponse: () => 1000,
      }),
      getOrSetCachedRadioMetadata("same", {
        now: () => 1000,
        retrieve,
        ttlForResponse: () => 1000,
      }),
    ]);

    expect(first).toEqual(success);
    expect(second).toEqual(success);
    expect(calls).toBe(1);
  });
});

describe("shared metadata cache", () => {
  test("stores shared responses in the edge cache", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "caches");
    const entries = new Map<string, Response>();
    const match = mock((key: string) =>
      Promise.resolve(entries.get(key)?.clone())
    );
    const put = mock((key: string, response: Response) => {
      entries.set(key, response.clone());
      return Promise.resolve();
    });
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: { default: { match, put } },
    });
    try {
      const retrieve = mock(() => Promise.resolve({ title: "Live" }));
      const options = {
        cache: edgeMetadataCache,
        key: ["live", "station"],
        now: () => 1000,
        retrieve,
        ttl: 900,
      };
      expect(await cacheMetadata(options)).toEqual({ title: "Live" });
      expect(await cacheMetadata(options)).toEqual({ title: "Live" });
      expect(retrieve).toHaveBeenCalledTimes(1);
      expect(match).toHaveBeenCalledTimes(2);
      expect(put).toHaveBeenCalledTimes(1);
      expect(put.mock.calls[0]?.[1].headers.get("Cache-Control")).toBe(
        "public, max-age=900"
      );
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "caches", original);
      } else {
        Reflect.deleteProperty(globalThis, "caches");
      }
    }
  });

  test("shares valid empty results and refreshes logically expired entries", async () => {
    const { cache, put } = createMetadataCacheFixture();
    let time = 1000;
    let calls = 0;
    const read = () =>
      cacheMetadata({
        cache,
        key: ["directory", "search", "empty", 10],
        now: () => time,
        retrieve: () => {
          calls += 1;
          return Promise.resolve([]);
        },
        ttl: 600,
      });
    expect(await read()).toEqual([]);
    expect(await read()).toEqual([]);
    expect(calls).toBe(1);
    expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 600 });
    time += 600_000;
    expect(await read()).toEqual([]);
    expect(calls).toBe(2);
  });

  test("keys include provider, operation and every argument even for long inputs", async () => {
    const { cache, entries } = createMetadataCacheFixture();
    const keys = [
      ["nts", "live", "x".repeat(2000), "1"],
      ["nts", "live", "x".repeat(2000), "2"],
      ["nts", "episode", "x".repeat(2000), "1"],
      ["lyl", "live", "x".repeat(2000), "1"],
    ];
    await Promise.all(
      keys.map(async (key, index) => {
        expect(
          await cacheMetadata({
            cache,
            key,
            retrieve: () => Promise.resolve(index),
            ttl: 60,
          })
        ).toBe(index);
      })
    );
    expect(entries.size).toBe(4);
    expect([...entries.keys()].every((key) => key.length < 512)).toBe(true);
  });

  test.each(["read", "write"])(
    "returns provider data after a cache %s failure",
    async (operation) => {
      const { cache, get, put } = createMetadataCacheFixture();
      (operation === "read" ? get : put).mockRejectedValue(
        new Error("cache unavailable")
      );
      expect(
        await cacheMetadata({
          cache,
          key: ["provider", "details"],
          retrieve: () => Promise.resolve({ title: "Valid" }),
          ttl: 60,
        })
      ).toEqual({ title: "Valid" });
    }
  );

  test("returns provider data after a stalled cache read", async () => {
    jest.useFakeTimers();
    try {
      const { cache, get, put } = createMetadataCacheFixture();
      const started = Promise.withResolvers<void>();
      const stalled = Promise.withResolvers<never>();
      get.mockImplementation(() => {
        started.resolve();
        return stalled.promise;
      });
      const value = { expiresAt: 2000, title: "Valid" };
      const retrieve = mock(() => Promise.resolve(value));
      let settled = false;
      const pending = cacheMetadata({
        cache,
        expiresAt: (result) => result.expiresAt,
        key: ["provider", "details"],
        now: () => 1000,
        retrieve,
        ttl: 60,
      }).then((result) => {
        settled = true;
        return result;
      });
      await started.promise;
      jest.advanceTimersByTime(499);
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(retrieve).toHaveBeenCalledTimes(0);

      jest.advanceTimersByTime(1);
      expect(await pending).toEqual(value);
      expect(retrieve).toHaveBeenCalledTimes(1);
      expect(JSON.parse(put.mock.calls[0]?.[1] ?? "null")).toEqual({
        expiresAt: 2000,
        value,
      });

      stalled.reject(new Error("late cache failure"));
      await Promise.resolve();
    } finally {
      jest.useRealTimers();
    }
  }, 1000);

  test("returns provider data after a stalled cache write", async () => {
    jest.useFakeTimers();
    try {
      const { cache, put } = createMetadataCacheFixture();
      const started = Promise.withResolvers<void>();
      const writing = Promise.withResolvers<void>();
      put.mockImplementation(() => {
        started.resolve();
        return writing.promise;
      });
      const pending = cacheMetadata({
        cache,
        key: ["provider", "details"],
        retrieve: () => Promise.resolve({ title: "Valid" }),
        ttl: 60,
      });
      await started.promise;
      jest.advanceTimersByTime(500);
      await expect(pending).resolves.toEqual({ title: "Valid" });
      writing.resolve();
    } finally {
      jest.useRealTimers();
    }
  });

  test("preserves provider expiry through retrieval and cache hits", async () => {
    const { cache, put } = createMetadataCacheFixture();
    let time = 1000;
    const retrieve = mock(() => {
      time += 250;
      return Promise.resolve(success);
    });
    const read = () =>
      cacheMetadata({
        cache,
        expiresAt: (result) => (result.ok ? result.data.expiresAt : 0),
        key: ["provider", "now-playing"],
        now: () => time,
        retrieve,
        ttl: 60,
      });
    expect(await read()).toEqual(success);
    expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 60 });
    time = 1999;
    expect(await read()).toEqual(success);
    expect(retrieve).toHaveBeenCalledTimes(1);
    time = 2000;
    expect(await read()).toEqual(success);
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledTimes(1);
  });

  test("does not cache upstream failures or null metadata", async () => {
    const { cache, put } = createMetadataCacheFixture();
    const options = { cache, key: ["provider", "details"], ttl: 60 };
    await expect(
      cacheMetadata({
        ...options,
        retrieve: () => Promise.reject(new Error("upstream")),
      })
    ).rejects.toThrow("upstream");
    expect(
      await cacheMetadata({ ...options, retrieve: () => Promise.resolve(null) })
    ).toBeNull();
    expect(put).not.toHaveBeenCalled();
    expect(
      await cacheMetadata({
        ...options,
        retrieve: () => Promise.resolve("recovered"),
      })
    ).toBe("recovered");
  });
});
