import { describe, expect, mock, test } from "bun:test";
import type { AppError } from "@avoid.quest/error";
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

describe("createStreamProxyRequestWorkflow", () => {
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
