import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AppError } from "@avoid.quest/error";
import {
  clearStreamAccessCache,
  inspectStreamAccess as inspectRealStreamAccess,
} from "./stream-access";
import { createStreamProxyRequestWorkflow } from "./stream-proxy-workflow";

function createTestPolicy() {
  return {
    errorHeaders(request: Request) {
      return {
        "Access-Control-Allow-Origin": new URL(request.url).origin,
      };
    },
    problem(error: AppError, origin: string, requestId: string) {
      return Response.json(
        {
          code: error.code,
          message: error.safeMessage,
          requestId,
          status: error.status,
        },
        {
          status: error.status,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "x-request-id": requestId,
          },
        }
      );
    },
  };
}

afterEach(() => {
  clearStreamAccessCache();
});

describe("createStreamProxyRequestWorkflow", () => {
  test("keeps missing request URL parameters on the request validation path", async () => {
    const inspectStreamAccess = mock(async () => {
      await Promise.resolve();
      return { mode: "proxy" as const, response: null, resolvedUrl: null };
    });
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response("should not fetch");
    });
    const workflow = createStreamProxyRequestWorkflow({
      fetchImpl,
      inspectStreamAccess,
      proxyPolicy: createTestPolicy(),
    });

    const response = await workflow.handle({
      origin: "https://radio.test",
      request: new Request("https://radio.test/api/stream-proxy"),
      requestId: "req_missing_url",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "STREAM_PROXY_URL_REQUIRED",
      message: "URL parameter is required",
      requestId: "req_missing_url",
      status: 400,
    });
    expect(inspectStreamAccess).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("redirects direct HTTPS streams with CORS and request headers", async () => {
    const inspectStreamAccess = mock(async () => {
      await Promise.resolve();
      return {
        mode: "direct" as const,
        response: null,
        resolvedUrl: "https://edge.example/live.mp3",
      };
    });
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response("should not fetch");
    });
    const workflow = createStreamProxyRequestWorkflow({
      fetchImpl,
      inspectStreamAccess,
      proxyPolicy: createTestPolicy(),
    });

    const response = await workflow.handle({
      origin: "https://radio.test",
      request: new Request(
        "https://radio.test/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Flive.mp3"
      ),
      requestId: "req_redirect",
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe(
      "https://edge.example/live.mp3"
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://radio.test"
    );
    expect(response.headers.get("x-request-id")).toBe("req_redirect");
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });

  test("rejects changed direct-stream redirects during access inspection", async () => {
    clearStreamAccessCache();

    let requestCount = 0;
    const fetchedUrls: string[] = [];
    const fetchImpl = mock(async (url: string) => {
      await Promise.resolve();
      requestCount += 1;
      fetchedUrls.push(url);

      if (requestCount === 1) {
        return new Response("direct", {
          headers: {
            "access-control-allow-origin": "*",
          },
        });
      }

      return Response.redirect("http://127.0.0.1/live.mp3", 302);
    });
    const workflow = createStreamProxyRequestWorkflow({
      fetchImpl,
      inspectStreamAccess: (url, options) =>
        inspectRealStreamAccess(url, { ...options, fetchImpl }),
      proxyPolicy: createTestPolicy(),
    });
    const request = new Request(
      "https://radio.test/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Flive.mp3"
    );

    const firstResponse = await workflow.handle({
      origin: "https://radio.test",
      request,
      requestId: "req_direct_first",
    });
    const secondResponse = await workflow.handle({
      origin: "https://radio.test",
      request,
      requestId: "req_direct_second",
    });

    expect(firstResponse.status).toBe(307);
    expect(firstResponse.headers.get("Location")).toBe(
      "https://radio.example/live.mp3"
    );
    expect(secondResponse.status).toBe(400);
    expect(secondResponse.headers.get("Location")).toBeNull();
    await expect(secondResponse.json()).resolves.toEqual({
      code: "STREAM_PROXY_INTERNAL_ADDRESS",
      message: "Internal addresses not allowed",
      requestId: "req_direct_second",
      status: 400,
    });
    expect(fetchedUrls).toEqual([
      "https://radio.example/live.mp3",
      "https://radio.example/live.mp3",
    ]);
  });

  test("maps access inspection redirect rejections without fallback refetch", async () => {
    const inspectStreamAccess = mock(async () => {
      await Promise.resolve();
      return {
        failure: {
          reason: "internal-address" as const,
          url: "http://127.0.0.1/live.mp3",
        },
        mode: "rejected" as const,
        response: null,
        resolvedUrl: null,
      };
    });
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response("should not fetch");
    });
    const workflow = createStreamProxyRequestWorkflow({
      fetchImpl,
      inspectStreamAccess,
      proxyPolicy: createTestPolicy(),
    });

    const response = await workflow.handle({
      origin: "https://radio.test",
      request: new Request(
        "https://radio.test/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Flive.mp3"
      ),
      requestId: "req_inspect_redirect_private",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "STREAM_PROXY_INTERNAL_ADDRESS",
      message: "Internal addresses not allowed",
      requestId: "req_inspect_redirect_private",
      status: 400,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });

  test("proxies preserved access responses with audio playback headers", async () => {
    const upstreamResponse = new Response("audio-bytes", {
      headers: {
        "Content-Length": "11",
        "Content-Range": "bytes 0-10/100",
        "Content-Type": "audio/aac",
        "Icy-Br": "128",
        "Icy-Genre": "Ambient",
        "Icy-MetaInt": "16000",
        "Icy-Name": "Example FM",
      },
      status: 206,
    });
    const inspectStreamAccess = mock(async () => {
      await Promise.resolve();
      return {
        mode: "proxy" as const,
        response: upstreamResponse,
        resolvedUrl: null,
      };
    });
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response("should not fetch");
    });
    const workflow = createStreamProxyRequestWorkflow({
      fetchImpl,
      inspectStreamAccess,
      proxyPolicy: createTestPolicy(),
    });

    const response = await workflow.handle({
      origin: "https://radio.test",
      request: new Request(
        "https://radio.test/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Flive.aac",
        {
          headers: {
            Range: "bytes=0-10",
          },
        }
      ),
      requestId: "req_proxy",
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Type")).toBe("audio/aac");
    expect(response.headers.get("Content-Length")).toBe("11");
    expect(response.headers.get("Content-Range")).toBe("bytes 0-10/100");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Icy-MetaInt")).toBe("16000");
    expect(response.headers.get("Icy-Name")).toBe("Example FM");
    expect(response.headers.get("Icy-Genre")).toBe("Ambient");
    expect(response.headers.get("Icy-Br")).toBe("128");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "Icy-MetaInt"
    );
    await expect(response.text()).resolves.toBe("audio-bytes");
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });

  test("fetches the original stream when access inspection cannot preserve a proxy response", async () => {
    let forwardedHeaders: Headers | null = null;
    const inspectStreamAccess = mock(async () => {
      await Promise.resolve();
      return { mode: "proxy" as const, response: null, resolvedUrl: null };
    });
    const fetchImpl = mock(async (_url: string, init?: RequestInit) => {
      await Promise.resolve();
      forwardedHeaders = new Headers(init?.headers);
      return new Response("fallback-audio", {
        headers: {
          "Content-Type": "audio/mpeg",
        },
      });
    });
    const workflow = createStreamProxyRequestWorkflow({
      fetchImpl,
      inspectStreamAccess,
      proxyPolicy: createTestPolicy(),
    });

    const response = await workflow.handle({
      origin: "https://radio.test",
      request: new Request(
        "https://radio.test/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Ffallback.mp3",
        {
          headers: {
            "Icy-MetaData": "1",
            Range: "bytes=100-200",
          },
        }
      ),
      requestId: "req_fallback",
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("fallback-audio");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://radio.example/fallback.mp3",
      expect.any(Object)
    );
    expect(forwardedHeaders).not.toBeNull();
    if (!forwardedHeaders) {
      throw new Error("Expected fallback fetch headers");
    }
    const headers: Headers = forwardedHeaders;
    expect(headers.get("Icy-MetaData")).toBe("1");
    expect(headers.get("Range")).toBe("bytes=100-200");
  });

  test("rejects fallback redirects to metadata hosts without fetching the target", async () => {
    const fetchedUrls: string[] = [];
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      fetchedUrls.push(url);

      if (
        url === "https://radio.example/fallback.mp3" &&
        init?.redirect !== "manual"
      ) {
        return new Response("metadata", {
          headers: {
            "Content-Type": "audio/mpeg",
          },
        });
      }

      return Response.redirect("http://metadata.google.internal/latest", 302);
    });
    const workflow = createStreamProxyRequestWorkflow({
      fetchImpl,
      inspectStreamAccess: mock(async () => {
        await Promise.resolve();
        return { mode: "proxy" as const, response: null, resolvedUrl: null };
      }),
      proxyPolicy: createTestPolicy(),
    });

    const response = await workflow.handle({
      origin: "https://radio.test",
      request: new Request(
        "https://radio.test/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Ffallback.mp3"
      ),
      requestId: "req_redirect_private",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "STREAM_PROXY_INTERNAL_ADDRESS",
      requestId: "req_redirect_private",
    });
    expect(fetchedUrls).toEqual(["https://radio.example/fallback.mp3"]);
  });

  test("rejects fallback redirect loops at the hop limit", async () => {
    const fetchedUrls: string[] = [];
    const fetchImpl = mock(async (url: string) => {
      await Promise.resolve();
      fetchedUrls.push(url);
      return Response.redirect(
        `https://radio.example/loop-${fetchedUrls.length}`,
        302
      );
    });
    const workflow = createStreamProxyRequestWorkflow({
      fetchImpl,
      inspectStreamAccess: mock(async () => {
        await Promise.resolve();
        return { mode: "proxy" as const, response: null, resolvedUrl: null };
      }),
      proxyPolicy: createTestPolicy(),
    });

    const response = await workflow.handle({
      origin: "https://radio.test",
      request: new Request(
        "https://radio.test/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Floop"
      ),
      requestId: "req_redirect_loop",
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: "STREAM_PROXY_TOO_MANY_REDIRECTS",
      requestId: "req_redirect_loop",
    });
    expect(fetchedUrls).toHaveLength(6);
  });

  test("rejects private stream URLs before access probes or upstream fetches", async () => {
    const inspectStreamAccess = mock(async () => {
      await Promise.resolve();
      return { mode: "proxy" as const, response: null, resolvedUrl: null };
    });
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response("should not fetch");
    });
    const workflow = createStreamProxyRequestWorkflow({
      fetchImpl,
      inspectStreamAccess,
      proxyPolicy: createTestPolicy(),
    });

    const response = await workflow.handle({
      origin: "https://radio.test",
      request: new Request(
        "https://radio.test/api/stream-proxy?url=http%3A%2F%2F127.0.0.1%2Flive"
      ),
      requestId: "req_private",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "STREAM_PROXY_INTERNAL_ADDRESS",
      requestId: "req_private",
    });
    expect(inspectStreamAccess).toHaveBeenCalledTimes(0);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });

  test("rejects malformed and unsupported stream URLs before access probes", async () => {
    const inspectStreamAccess = mock(async () => {
      await Promise.resolve();
      return { mode: "proxy" as const, response: null, resolvedUrl: null };
    });
    const workflow = createStreamProxyRequestWorkflow({
      fetchImpl: mock(async () => new Response("should not fetch")),
      inspectStreamAccess,
      proxyPolicy: createTestPolicy(),
    });

    const malformedResponse = await workflow.handle({
      origin: "https://radio.test",
      request: new Request("https://radio.test/api/stream-proxy?url=not-a-url"),
      requestId: "req_malformed",
    });
    const protocolResponse = await workflow.handle({
      origin: "https://radio.test",
      request: new Request(
        "https://radio.test/api/stream-proxy?url=ftp%3A%2F%2Fradio.example%2Flive"
      ),
      requestId: "req_protocol",
    });

    expect(malformedResponse.status).toBe(400);
    await expect(malformedResponse.json()).resolves.toMatchObject({
      code: "STREAM_PROXY_INVALID_URL",
    });
    expect(protocolResponse.status).toBe(400);
    await expect(protocolResponse.json()).resolves.toMatchObject({
      code: "STREAM_PROXY_INVALID_PROTOCOL",
    });
    expect(inspectStreamAccess).toHaveBeenCalledTimes(0);
  });

  test("maps upstream error statuses to safe problem responses", async () => {
    const workflow = createStreamProxyRequestWorkflow({
      fetchImpl: mock(async () => {
        await Promise.resolve();
        return new Response("forbidden", {
          status: 403,
          statusText: "Forbidden",
        });
      }),
      inspectStreamAccess: mock(async () => {
        await Promise.resolve();
        return { mode: "proxy" as const, response: null, resolvedUrl: null };
      }),
      proxyPolicy: createTestPolicy(),
    });

    const response = await workflow.handle({
      origin: "https://radio.test",
      request: new Request(
        "https://radio.test/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Fblocked"
      ),
      requestId: "req_upstream",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "STREAM_PROXY_UPSTREAM_ERROR",
      message: "Upstream error: 403 Forbidden",
      requestId: "req_upstream",
      status: 403,
    });
  });

  test("maps upstream fetch failures to safe problem responses", async () => {
    const captureError = mock(() => undefined);
    const workflow = createStreamProxyRequestWorkflow({
      captureError,
      fetchImpl: mock(async () => {
        await Promise.resolve();
        throw new Error("network details should stay private");
      }),
      inspectStreamAccess: mock(async () => {
        await Promise.resolve();
        return { mode: "proxy" as const, response: null, resolvedUrl: null };
      }),
      proxyPolicy: createTestPolicy(),
    });

    const response = await workflow.handle({
      origin: "https://radio.test",
      request: new Request(
        "https://radio.test/api/stream-proxy?url=https%3A%2F%2Fradio.example%2Ftimeout"
      ),
      requestId: "req_fetch_failed",
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      code: "STREAM_PROXY_FETCH_FAILED",
      message: "Failed to fetch stream",
      requestId: "req_fetch_failed",
      status: 502,
    });
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});
