import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  clearStreamAccessCache,
  determineStreamAccessMode,
  fetchPublicStreamWithRedirects,
  inspectStreamAccess,
} from "./stream-access";

afterEach(() => {
  clearStreamAccessCache();
});

describe("fetchPublicStreamWithRedirects", () => {
  test("returns a typed public redirect fetch result on success", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response("ok");
    });

    const result = await fetchPublicStreamWithRedirects(
      "https://radio.example/live",
      { method: "GET" },
      fetchImpl
    );

    expect(result.ok).toBeTrue();
    if (!result.ok) {
      throw new Error("Expected successful public stream fetch");
    }
    expect(result.resolvedUrl).toBe("https://radio.example/live");
  });

  test("maps empty concrete stream URLs to invalid URL", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      throw new Error("Empty stream URLs should not be fetched");
    });

    await expect(
      fetchPublicStreamWithRedirects("", { method: "GET" }, fetchImpl)
    ).resolves.toEqual({
      failure: {
        reason: "invalid-url",
        url: "",
      },
      ok: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
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

  test("revalidates cached direct decisions when inspecting streams", async () => {
    let requestCount = 0;
    const requestedUrls: string[] = [];
    const redirectModes: Array<RequestRedirect | undefined> = [];
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      requestCount += 1;
      requestedUrls.push(url);
      redirectModes.push(init?.redirect);

      if (requestCount === 1) {
        return new Response("ok", {
          headers: {
            "access-control-allow-origin": "*",
          },
        });
      }

      return Response.redirect("http://127.0.0.1/live", 302);
    });

    await expect(
      inspectStreamAccess("https://radio.example/live", {
        fetchImpl,
        origin: "https://radio.test",
      })
    ).resolves.toMatchObject({
      mode: "direct",
      resolvedUrl: "https://radio.example/live",
    });
    await expect(
      inspectStreamAccess("https://radio.example/live", {
        fetchImpl,
        origin: "https://radio.test",
      })
    ).resolves.toMatchObject({
      failure: {
        reason: "internal-address",
        url: "http://127.0.0.1/live",
      },
      mode: "rejected",
    });
    await expect(
      determineStreamAccessMode("https://radio.example/live", {
        fetchImpl,
        origin: "https://radio.test",
      })
    ).resolves.toBe("rejected");
    expect(requestedUrls).toEqual([
      "https://radio.example/live",
      "https://radio.example/live",
      "https://radio.example/live",
    ]);
    expect(redirectModes).toEqual(["manual", "manual", "manual"]);
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

  test("returns the resolved final URL for valid public redirects", async () => {
    const requestedUrls: string[] = [];
    const redirectModes: Array<RequestRedirect | undefined> = [];
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      requestedUrls.push(url);
      redirectModes.push(init?.redirect);

      if (url === "https://radio.example/live") {
        return Response.redirect("https://edge.example/live", 302);
      }

      return new Response("ok", {
        headers: {
          "access-control-allow-origin": "*",
        },
      });
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
    expect(requestedUrls).toEqual([
      "https://radio.example/live",
      "https://edge.example/live",
    ]);
    expect(redirectModes).toEqual(["manual", "manual"]);
  });

  test("rejects redirects to loopback addresses without modeling them as proxy", async () => {
    const requestedUrls: string[] = [];
    const redirectModes: Array<RequestRedirect | undefined> = [];
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      requestedUrls.push(url);
      redirectModes.push(init?.redirect);

      if (url === "https://radio.example/live" && init?.redirect !== "manual") {
        return new Response("internal", {
          headers: {
            "access-control-allow-origin": "*",
          },
        });
      }

      return Response.redirect("http://127.0.0.1/live", 302);
    });

    const decision = await inspectStreamAccess("https://radio.example/live", {
      fetchImpl,
      origin: "https://radio.test",
    });

    expect(decision).toMatchObject({
      failure: {
        reason: "internal-address",
        url: "http://127.0.0.1/live",
      },
      mode: "rejected",
    });
    expect(requestedUrls).toEqual(["https://radio.example/live"]);
    expect(redirectModes).toEqual(["manual"]);
  });

  test("stops after the redirect hop limit", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = mock(async (url: string) => {
      await Promise.resolve();
      requestedUrls.push(url);
      return Response.redirect(
        `https://radio.example/live-${requestedUrls.length}`,
        302
      );
    });

    await expect(
      inspectStreamAccess("https://radio.example/live", {
        fetchImpl,
        origin: "https://radio.test",
      })
    ).resolves.toMatchObject({
      failure: {
        reason: "too-many-redirects",
        url: "https://radio.example/live-5",
      },
      mode: "rejected",
    });
    expect(requestedUrls).toHaveLength(6);
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
