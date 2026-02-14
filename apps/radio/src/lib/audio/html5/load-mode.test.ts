import { describe, expect, test } from "bun:test";
import {
  createLoadModeCache,
  getInitialLoadMode,
  getRetryLoadMode,
  type Html5LoadMode,
  mapPlaybackFailureMessage,
  shouldRetryWithoutCors,
} from "./load-mode";

class MemoryStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe("load mode cache", () => {
  test("persists and reads mode by streamUrl", () => {
    const storage = new MemoryStorage();
    const cache = createLoadModeCache(storage);
    const url = "https://example.test/stream";

    expect(cache.get(url)).toBeNull();
    cache.set(url, "no-cors");
    expect(cache.get(url)).toBe("no-cors");
  });

  test("ignores invalid stored values", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "radio-app-html5-load-modes",
      JSON.stringify({ "https://example.test/stream": "invalid" })
    );
    const cache = createLoadModeCache(storage);
    expect(cache.get("https://example.test/stream")).toBeNull();
  });
});

describe("load mode ordering", () => {
  test("defaults to strict CORS mode", () => {
    expect(getInitialLoadMode(null)).toBe("cors-anonymous");
  });

  test("uses cached mode first when available", () => {
    const cached: Html5LoadMode = "no-cors";
    expect(getInitialLoadMode(cached)).toBe("no-cors");
  });

  test("retries only from cors-anonymous to no-cors", () => {
    expect(getRetryLoadMode("cors-anonymous", true)).toBe("no-cors");
    expect(getRetryLoadMode("no-cors", true)).toBeNull();
    expect(getRetryLoadMode("cors-anonymous", false)).toBeNull();
  });
});

describe("retry eligibility and message mapping", () => {
  test("marks format errors as retryable", () => {
    const domError = new DOMException("unsupported", "NotSupportedError");
    expect(shouldRetryWithoutCors(domError, null)).toBe(true);
    expect(shouldRetryWithoutCors(new Error("no supported source"), null)).toBe(
      true
    );
    expect(shouldRetryWithoutCors(new Error("x"), 4)).toBe(true);
  });

  test("marks cors-like failures as retryable", () => {
    expect(
      shouldRetryWithoutCors(
        new Error("blocked by CORS policy: No Access-Control-Allow-Origin"),
        null
      )
    ).toBe(true);
  });

  test("does not retry non-format errors", () => {
    expect(shouldRetryWithoutCors(new Error("network"), 2)).toBe(false);
  });

  test("maps known media codes to deterministic messages", () => {
    expect(mapPlaybackFailureMessage(new Error("x"), 4)).toBe(
      "Unsupported stream format for this browser"
    );
    expect(mapPlaybackFailureMessage(new Error("x"), 2)).toBe(
      "Network error while loading stream"
    );
    expect(mapPlaybackFailureMessage(new Error("x"), 3)).toBe(
      "Stream decode error"
    );
  });

  test("maps endpoint failures to unavailable message", () => {
    expect(
      mapPlaybackFailureMessage(
        new Error("403 Station config not found (Redis)"),
        null
      )
    ).toBe("Stream endpoint unavailable");
  });
});
