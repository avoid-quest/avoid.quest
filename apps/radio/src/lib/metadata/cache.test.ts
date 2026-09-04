import { describe, expect, test } from "bun:test";
import {
  cacheMetadata,
  clearRadioMetadataCache,
  getCachedRadioMetadata,
  getOrSetCachedRadioMetadata,
  setCachedRadioMetadata,
} from "./cache";
import { createMetadataKvFixture } from "./kv-test-fixture";
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
    const { kv, put } = createMetadataKvFixture();
    let time = 1000;
    let calls = 0;
    const read = () =>
      cacheMetadata({
        key: ["directory", "search", "empty", 10],
        kv,
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
    const { kv, entries } = createMetadataKvFixture();
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
            kv,
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
    "returns provider data after a KV %s failure",
    async (operation) => {
      const { kv, get, put } = createMetadataKvFixture();
      (operation === "read" ? get : put).mockRejectedValue(
        new Error("KV unavailable")
      );
      expect(
        await cacheMetadata({
          key: ["provider", "details"],
          kv,
          retrieve: () => Promise.resolve({ title: "Valid" }),
          ttl: 60,
        })
      ).toEqual({ title: "Valid" });
    }
  );

  test("does not cache upstream failures or null metadata", async () => {
    const { kv, put } = createMetadataKvFixture();
    const options = { key: ["provider", "details"], kv, ttl: 60 };
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
