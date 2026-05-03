import { describe, expect, mock, test } from "bun:test";
import { AppError } from "@avoid.quest/error";
import { createProxyRequestPolicy } from "./request-policy";

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
