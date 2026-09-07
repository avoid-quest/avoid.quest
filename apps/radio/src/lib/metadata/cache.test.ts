import { describe, expect, jest, mock, test } from "bun:test";
import {
  cacheMetadata,
  clearRadioMetadataCache,
  getCachedRadioMetadata,
  getOrSetCachedRadioMetadata,
  setCachedRadioMetadata,
} from "./cache";
import { createMetadataStoreFixture } from "./store-test-fixture";
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
  test("shares valid empty results and refreshes logically expired entries", async () => {
    const { store, put } = createMetadataStoreFixture();
    let time = 1000;
    let calls = 0;
    const read = () =>
      cacheMetadata({
        key: ["directory", "search", "empty", 10],
        now: () => time,
        retrieve: () => {
          calls += 1;
          return Promise.resolve([]);
        },
        store,
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
    const { store, entries } = createMetadataStoreFixture();
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
            key,
            retrieve: () => Promise.resolve(index),
            store,
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
      const { store, get, put } = createMetadataStoreFixture();
      (operation === "read" ? get : put).mockRejectedValue(
        new Error("cache unavailable")
      );
      expect(
        await cacheMetadata({
          key: ["provider", "details"],
          retrieve: () => Promise.resolve({ title: "Valid" }),
          store,
          ttl: 60,
        })
      ).toEqual({ title: "Valid" });
    }
  );

  test.each(["read", "write"])(
    "returns provider data after a stalled cache %s",
    async (operation) => {
      jest.useFakeTimers();
      try {
        const { store, get, put } = createMetadataStoreFixture();
        const started = Promise.withResolvers<void>();
        const stalled = Promise.withResolvers<never>();
        (operation === "read" ? get : put).mockImplementation(() => {
          started.resolve();
          return stalled.promise;
        });
        const value = { expiresAt: 2000, title: "Valid" };
        const retrieve = mock(() => Promise.resolve(value));
        let settled = false;
        const pending = cacheMetadata({
          expiresAt: (result) => result.expiresAt,
          key: ["provider", "details"],
          now: () => 1000,
          retrieve,
          store,
          ttl: 60,
        }).then((result) => {
          settled = true;
          return result;
        });
        await started.promise;
        jest.advanceTimersByTime(499);
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(retrieve).toHaveBeenCalledTimes(operation === "read" ? 0 : 1);

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
    },
    1000
  );

  test("preserves provider expiry through retrieval and cache hits", async () => {
    const { store, put } = createMetadataStoreFixture();
    let time = 1000;
    const retrieve = mock(() => {
      time += 250;
      return Promise.resolve(success);
    });
    const read = () =>
      cacheMetadata({
        expiresAt: (result) => (result.ok ? result.data.expiresAt : 0),
        key: ["provider", "now-playing"],
        now: () => time,
        retrieve,
        store,
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
    const { store, put } = createMetadataStoreFixture();
    const options = { key: ["provider", "details"], store, ttl: 60 };
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
