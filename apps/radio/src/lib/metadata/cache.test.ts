import { describe, expect, test } from "bun:test";
import {
  clearRadioMetadataCache,
  getCachedRadioMetadata,
  getOrSetCachedRadioMetadata,
  setCachedRadioMetadata,
} from "./cache";
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
