import { describe, expect, mock, test } from "bun:test";
import type { AppError } from "@avoid.quest/error";
import {
  BANDCAMP_CDN_PROXY_CONFIG,
  proxyCdnUrl,
  SOUNDCLOUD_CDN_PROXY_CONFIG,
  validateCdnProxyUrl,
} from "./cdn-proxy-workflow";
import type { createProxyRequestPolicy } from "./request-policy";

function createTestPolicy(): ReturnType<typeof createProxyRequestPolicy> {
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
    options() {
      return new Response(null);
    },
    run() {
      return Promise.resolve(new Response(null));
    },
  };
}

describe("validateCdnProxyUrl", () => {
  test("allows Bandcamp CDN hostnames", () => {
    const result = validateCdnProxyUrl({
      urlParam: "https://t4.bcbits.com/stream/example.mp3",
      config: BANDCAMP_CDN_PROXY_CONFIG,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe("https://t4.bcbits.com/stream/example.mp3");
    }
  });

  test("rejects Bandcamp substring hostname spoofing", () => {
    const result = validateCdnProxyUrl({
      urlParam: "https://evil.example/audio.mp3?u=bcbits.com",
      config: BANDCAMP_CDN_PROXY_CONFIG,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BANDCAMP_PROXY_INVALID_DOMAIN");
      expect(result.error.status).toBe(400);
    }
  });

  test("rejects non-http protocols", () => {
    const result = validateCdnProxyUrl({
      urlParam: "file://t4.bcbits.com/private.mp3",
      config: BANDCAMP_CDN_PROXY_CONFIG,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BANDCAMP_PROXY_INVALID_PROTOCOL");
    }
  });

  test("allows only explicit SoundCloud CDN hostnames", () => {
    const result = validateCdnProxyUrl({
      urlParam: "https://cf-media.sndcdn.com/abc.128.mp3",
      config: SOUNDCLOUD_CDN_PROXY_CONFIG,
    });

    expect(result.ok).toBe(true);
  });

  test("rejects SoundCloud page URLs", () => {
    const result = validateCdnProxyUrl({
      urlParam: "https://soundcloud.com/artist/track",
      config: SOUNDCLOUD_CDN_PROXY_CONFIG,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SOUNDCLOUD_PROXY_PAGE_URL_NOT_ALLOWED");
    }
  });
});

describe("proxyCdnUrl", () => {
  test("cancels upstream response bodies before returning upstream errors", async () => {
    let cancelled = false;
    const fetchImpl = mock(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status: 502, statusText: "Bad Gateway" }
        )
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    try {
      const response = await proxyCdnUrl({
        config: BANDCAMP_CDN_PROXY_CONFIG,
        origin: "https://radio.example",
        proxyPolicy: createTestPolicy(),
        request: new Request("https://radio.example/api/bandcamp-proxy"),
        requestId: "req-test",
        url: "https://t4.bcbits.com/stream/example.mp3",
      });

      expect(response.status).toBe(502);
      expect(cancelled).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("cancels upstream response bodies before rejecting oversized responses", async () => {
    let cancelled = false;
    const fetchImpl = mock(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          {
            headers: { "Content-Length": `${101 * 1024 * 1024}` },
            status: 200,
          }
        )
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    try {
      const response = await proxyCdnUrl({
        config: BANDCAMP_CDN_PROXY_CONFIG,
        origin: "https://radio.example",
        proxyPolicy: createTestPolicy(),
        request: new Request("https://radio.example/api/bandcamp-proxy"),
        requestId: "req-test",
        url: "https://t4.bcbits.com/stream/example.mp3",
      });

      expect(response.status).toBe(413);
      expect(cancelled).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
