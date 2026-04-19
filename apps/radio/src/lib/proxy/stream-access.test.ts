import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  clearStreamAccessCache,
  determineStreamAccessMode,
  inspectStreamAccess,
} from "./stream-access";

afterEach(() => {
  clearStreamAccessCache();
});

describe("determineStreamAccessMode", () => {
  test("returns direct when the upstream stream allows any origin", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response("ok", {
        headers: {
          "access-control-allow-origin": "*",
        },
      });
    });

    await expect(
      determineStreamAccessMode("https://radio.example/live", {
        fetchImpl,
        origin: "https://radio.test",
      })
    ).resolves.toBe("direct");
  });

  test("returns direct when the upstream stream allows the current origin", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response("ok", {
        headers: {
          "access-control-allow-origin": "https://radio.test",
        },
      });
    });

    await expect(
      determineStreamAccessMode("https://radio.example/live", {
        fetchImpl,
        origin: "https://radio.test",
      })
    ).resolves.toBe("direct");
  });

  test("returns proxy when the upstream stream does not expose CORS", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response("ok");
    });

    await expect(
      determineStreamAccessMode("https://radio.example/live", {
        fetchImpl,
        origin: "https://radio.test",
      })
    ).resolves.toBe("proxy");
  });

  test("caches stream access decisions per URL", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response("ok", {
        headers: {
          "access-control-allow-origin": "*",
        },
      });
    });

    await determineStreamAccessMode("https://radio.example/live", {
      fetchImpl,
      origin: "https://radio.test",
    });
    await determineStreamAccessMode("https://radio.example/live", {
      fetchImpl,
      origin: "https://radio.test",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("scopes cached decisions by request origin", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response("ok", {
        headers: {
          "access-control-allow-origin": "*",
        },
      });
    });

    await determineStreamAccessMode("https://radio.example/live", {
      fetchImpl,
      origin: "https://radio-a.test",
    });
    await determineStreamAccessMode("https://radio.example/live", {
      fetchImpl,
      origin: "https://radio-b.test",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("falls back to proxy when the probe fails", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      throw new Error("boom");
    });

    await expect(
      determineStreamAccessMode("https://radio.example/live", {
        fetchImpl,
        origin: "https://radio.test",
      })
    ).resolves.toBe("proxy");
  });

  test("returns the resolved final URL for direct redirects", async () => {
    const response = new Response("ok", {
      headers: {
        "access-control-allow-origin": "*",
      },
    });
    Object.defineProperty(response, "url", {
      configurable: true,
      value: "https://edge.example/live",
    });
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return response;
    });

    await expect(
      inspectStreamAccess("https://radio.example/live", {
        fetchImpl,
        origin: "https://radio.test",
      })
    ).resolves.toMatchObject({
      mode: "direct",
      resolvedUrl: "https://edge.example/live",
    });
  });

  test("reuses the caller headers when preserving a proxied response", async () => {
    let receivedHeaders: Headers | null = null;
    const fetchImpl = mock(async (_url: string, init?: RequestInit) => {
      await Promise.resolve();
      receivedHeaders = new Headers(init?.headers);
      return new Response("ok");
    });

    const requestHeaders = new Headers({
      "Icy-MetaData": "1",
      Range: "bytes=128-255",
    });

    await expect(
      inspectStreamAccess("https://radio.example/live", {
        fetchImpl,
        origin: "https://radio.test",
        requestHeaders,
      })
    ).resolves.toMatchObject({
      mode: "proxy",
      response: expect.any(Response),
    });

    expect(receivedHeaders).not.toBeNull();
    if (!receivedHeaders) {
      throw new Error("Expected inspectStreamAccess to forward headers");
    }
    const forwardedHeaders: Headers = receivedHeaders;
    expect(forwardedHeaders.get("Icy-MetaData")).toBe("1");
    expect(forwardedHeaders.get("Range")).toBe("bytes=128-255");
  });
});
