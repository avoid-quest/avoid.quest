import { describe, expect, mock, test } from "bun:test";
import { AppError } from "@avoid.quest/error";
import { createProxyRequestPolicy } from "./request-policy";

const GENERATED_SESSION_ID = "a".repeat(64);
const EXISTING_SESSION_ID = "b".repeat(64);

describe("createProxyRequestPolicy", () => {
  test("creates problem responses with CORS and request IDs", async () => {
    const policy = createProxyRequestPolicy({
      validateAuthAndRateLimit: mock(async () => {
        await Promise.resolve();
        throw new Error("unused");
      }),
    });
    const response = policy.problem(
      new AppError({
        code: "PROXY_INVALID_URL",
        safeMessage: "Invalid URL",
        category: "validation",
        expected: true,
        status: 400,
      }),
      "https://radio.test",
      "req_problem"
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://radio.test"
    );
    expect(response.headers.get("x-request-id")).toBe("req_problem");
    await expect(response.json()).resolves.toEqual({
      code: "PROXY_INVALID_URL",
      message: "Invalid URL",
      requestId: "req_problem",
      status: 400,
    });
  });

  test("creates OPTIONS responses with shared CORS policy", () => {
    const policy = createProxyRequestPolicy({
      validateAuthAndRateLimit: mock(async () => {
        await Promise.resolve();
        throw new Error("unused");
      }),
    });

    const response = policy.options(
      new Request("https://radio.test/api/stream-proxy", {
        method: "OPTIONS",
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://radio.test"
    );
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  test("runs proxy handlers through shared auth and request context", async () => {
    const validateAuthAndRateLimit = mock(
      async (_request, _env, _identifier, options) => {
        await Promise.resolve();
        return {
          sessionId: "session_123",
          ip: "127.0.0.1",
          shouldSetCookie: options?.createSessionIfMissing ?? true,
        };
      }
    );
    const policy = createProxyRequestPolicy({ validateAuthAndRateLimit });
    const response = await policy.run({
      request: new Request("https://radio.test/api/stream-proxy"),
      env: {},
      identifier: "stream-proxy",
      operation: "stream-proxy.GET",
      fallback: {
        code: "STREAM_PROXY_INTERNAL_ERROR",
        safeMessage: "Internal server error",
        category: "infrastructure",
        expected: false,
        status: 500,
      },
      run: async ({ auth, origin, requestId }) => {
        await Promise.resolve();
        expect(origin).toBe("https://radio.test");
        expect(requestId).toBeTruthy();
        expect(auth).toEqual({
          sessionId: "session_123",
          ip: "127.0.0.1",
          shouldSetCookie: true,
        });
        return new Response("ok");
      },
    });

    expect(validateAuthAndRateLimit).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  test("creates GET adapters backed by the shared proxy policy", async () => {
    const validateAuthAndRateLimit = mock(
      async (_request, _env, _identifier, options) => {
        await Promise.resolve();
        return {
          sessionId: "session_123",
          ip: "127.0.0.1",
          shouldSetCookie: options?.createSessionIfMissing ?? true,
        };
      }
    );
    const policy = createProxyRequestPolicy({ validateAuthAndRateLimit });
    const get = policy.get({
      env: {},
      identifier: "stream-proxy",
      operation: "stream-proxy.GET",
      fallback: {
        code: "STREAM_PROXY_INTERNAL_ERROR",
        safeMessage: "Internal server error",
        category: "infrastructure",
        expected: false,
        status: 500,
      },
      run: async ({ request }) => {
        await Promise.resolve();
        expect(request.url).toBe("https://radio.test/api/stream-proxy");
        return new Response("ok");
      },
    });

    const response = await get({
      request: new Request("https://radio.test/api/stream-proxy"),
    });

    expect(validateAuthAndRateLimit).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
  });

  test("sets generated session cookies on proxy handler responses", async () => {
    const validateAuthAndRateLimit = mock(async () => {
      await Promise.resolve();
      return {
        sessionId: GENERATED_SESSION_ID,
        ip: "127.0.0.1",
        shouldSetCookie: true,
      };
    });
    const policy = createProxyRequestPolicy({ validateAuthAndRateLimit });
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("audio-bytes"));
        controller.close();
      },
    });

    const response = await policy.run({
      request: new Request("https://radio.test/api/stream-proxy"),
      env: {},
      identifier: "stream-proxy",
      operation: "stream-proxy.GET",
      fallback: {
        code: "STREAM_PROXY_INTERNAL_ERROR",
        safeMessage: "Internal server error",
        category: "infrastructure",
        expected: false,
        status: 500,
      },
      run: async () => {
        await Promise.resolve();
        return new Response(body, {
          status: 206,
          headers: {
            "Content-Type": "audio/mpeg",
            "Set-Cookie": "existing=1; Path=/",
            "x-upstream": "preserved",
          },
        });
      },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("x-upstream")).toBe("preserved");
    expect(response.headers.get("set-cookie")).toContain("existing=1");
    expect(response.headers.get("set-cookie")).toContain(
      `radio_session_id=${GENERATED_SESSION_ID}`
    );
    await expect(response.text()).resolves.toBe("audio-bytes");
  });

  test("does not set session cookies when auth reused an existing session", async () => {
    const validateAuthAndRateLimit = mock(async () => {
      await Promise.resolve();
      return {
        sessionId: EXISTING_SESSION_ID,
        ip: "127.0.0.1",
        shouldSetCookie: false,
      };
    });
    const policy = createProxyRequestPolicy({ validateAuthAndRateLimit });

    const response = await policy.run({
      request: new Request("https://radio.test/api/stream-proxy"),
      env: {},
      identifier: "stream-proxy",
      operation: "stream-proxy.GET",
      fallback: {
        code: "STREAM_PROXY_INTERNAL_ERROR",
        safeMessage: "Internal server error",
        category: "infrastructure",
        expected: false,
        status: 500,
      },
      run: async () => {
        await Promise.resolve();
        return new Response("ok");
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("returns auth responses unchanged when the policy blocks the request", async () => {
    const blockedResponse = new Response("blocked", {
      status: 429,
      headers: {
        "x-request-id": "req_blocked",
      },
    });
    const policy = createProxyRequestPolicy({
      validateAuthAndRateLimit: mock(async () => {
        await Promise.resolve();
        return blockedResponse;
      }),
    });

    const response = await policy.run({
      request: new Request("https://radio.test/api/stream-proxy"),
      env: {},
      identifier: "stream-proxy",
      operation: "stream-proxy.GET",
      fallback: {
        code: "STREAM_PROXY_INTERNAL_ERROR",
        safeMessage: "Internal server error",
        category: "infrastructure",
        expected: false,
        status: 500,
      },
      run: async () => {
        await Promise.resolve();
        return new Response("should not run");
      },
    });

    expect(response.status).toBe(429);
    await expect(response.text()).resolves.toBe("blocked");
  });
});
