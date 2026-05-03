/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { AppError, captureError } from "@avoid.quest/error";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { logSSRFAttempt } from "@/lib/logger";
import { createProxyRequestPolicy } from "@/lib/proxy/request-policy";

const ALLOWED_SOUNDCLOUD_DOMAINS = [
  "cf-media.sndcdn.com",
  "cf-hls-media.sndcdn.com",
  "media.soundcloud.com",
  "ec-media.sndcdn.com",
] as const;

const URL_SCHEMA = z
  .string()
  .max(2048)
  .refine((val) => {
    try {
      new URL(val);
      return true;
    } catch {
      return false;
    }
  }, "Invalid URL format");
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_SIZE = 100 * 1024 * 1024;

const proxyPolicy = createProxyRequestPolicy();

function validateSoundCloudUrl(
  urlParam: string | null,
  origin: string,
  sessionId: string,
  ip: string | undefined,
  requestId: string
): string | Response {
  if (!urlParam) {
    return proxyPolicy.problem(
      new AppError({
        code: "SOUNDCLOUD_PROXY_URL_REQUIRED",
        safeMessage: "URL parameter is required",
        category: "validation",
        expected: true,
        status: 400,
      }),
      origin,
      requestId
    );
  }

  const urlValidation = URL_SCHEMA.safeParse(urlParam);
  if (!urlValidation.success) {
    return proxyPolicy.problem(
      new AppError({
        code: "SOUNDCLOUD_PROXY_INVALID_URL",
        safeMessage: "Invalid URL format",
        category: "validation",
        expected: true,
        status: 400,
      }),
      origin,
      requestId
    );
  }

  let urlObj: URL;
  try {
    urlObj = new URL(urlParam);
  } catch {
    return proxyPolicy.problem(
      new AppError({
        code: "SOUNDCLOUD_PROXY_INVALID_URL",
        safeMessage: "Invalid URL format",
        category: "validation",
        expected: true,
        status: 400,
      }),
      origin,
      requestId
    );
  }

  if (
    urlObj.hostname === "soundcloud.com" ||
    urlObj.hostname === "www.soundcloud.com"
  ) {
    return proxyPolicy.problem(
      new AppError({
        code: "SOUNDCLOUD_PROXY_PAGE_URL_NOT_ALLOWED",
        safeMessage: "Invalid URL: must be a stream URL, not a page URL",
        category: "validation",
        expected: true,
        status: 400,
      }),
      origin,
      requestId
    );
  }

  if (
    !ALLOWED_SOUNDCLOUD_DOMAINS.includes(
      urlObj.hostname as (typeof ALLOWED_SOUNDCLOUD_DOMAINS)[number]
    )
  ) {
    logSSRFAttempt(sessionId, urlParam, "soundcloud-proxy", ip);
    return proxyPolicy.problem(
      new AppError({
        code: "SOUNDCLOUD_PROXY_INVALID_DOMAIN",
        safeMessage: "Invalid domain: not a SoundCloud CDN domain",
        category: "security",
        expected: true,
        status: 400,
      }),
      origin,
      requestId
    );
  }

  return urlParam;
}

async function fetchWithTimeout(
  url: string,
  request: Request,
  origin: string,
  requestId: string
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const rangeHeader = request.headers.get("range");
    const requestHeaders: HeadersInit = {
      Referer: "https://soundcloud.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };
    if (rangeHeader) {
      requestHeaders.Range = rangeHeader;
    }

    const res = await fetch(url, {
      signal: controller.signal,
      headers: requestHeaders,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return proxyPolicy.problem(
        new AppError({
          code: "SOUNDCLOUD_PROXY_UPSTREAM_ERROR",
          safeMessage: `Failed to fetch stream: ${res.statusText}`,
          category: "dependency",
          expected: false,
          status: res.status,
        }),
        origin,
        requestId
      );
    }

    const contentLength = res.headers.get("Content-Length");
    if (contentLength) {
      const size = Number.parseInt(contentLength, 10);
      if (size > MAX_RESPONSE_SIZE) {
        return proxyPolicy.problem(
          new AppError({
            code: "SOUNDCLOUD_PROXY_RESPONSE_TOO_LARGE",
            safeMessage: "Response too large",
            category: "validation",
            expected: true,
            status: 413,
          }),
          origin,
          requestId
        );
      }
    }

    const headers: HeadersInit = {
      ...proxyPolicy.errorHeaders(request),
      "Content-Type": res.headers.get("Content-Type") || "audio/mpeg",
      "Accept-Ranges": "bytes",
      "x-request-id": requestId,
    };
    const length = res.headers.get("Content-Length");
    const range = res.headers.get("Content-Range");
    if (length) {
      headers["Content-Length"] = length;
    }
    if (range) {
      headers["Content-Range"] = range;
    }

    return new Response(res.body, { status: res.status, headers });
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === "AbortError") {
      return proxyPolicy.problem(
        new AppError({
          code: "SOUNDCLOUD_PROXY_TIMEOUT",
          safeMessage: "Request timeout",
          category: "network",
          expected: true,
          status: 408,
        }),
        origin,
        requestId
      );
    }

    const appError = new AppError({
      code: "SOUNDCLOUD_PROXY_FETCH_FAILED",
      safeMessage: "Failed to fetch stream",
      category: "network",
      expected: false,
      status: 500,
    });

    captureError(error instanceof AppError ? error : appError, {
      surface: "api-route",
      operation: "soundcloud-proxy.fetch",
      requestId,
    });

    return proxyPolicy.problem(appError, origin, requestId);
  }
}

export const Route = createFileRoute("/api/soundcloud-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return proxyPolicy.run({
          request,
          env,
          identifier: "soundcloud-proxy",
          operation: "soundcloud-proxy.GET",
          fallback: {
            code: "SOUNDCLOUD_PROXY_INTERNAL_ERROR",
            safeMessage: "Internal server error",
            category: "infrastructure",
            expected: false,
            status: 500,
          },
          run: async ({ auth, origin, request, requestId }) => {
            const urlParam = new URL(request.url).searchParams.get("url");
            const urlValidation = validateSoundCloudUrl(
              urlParam,
              origin,
              auth.sessionId,
              auth.ip,
              requestId
            );
            if (urlValidation instanceof Response) {
              return urlValidation;
            }

            return fetchWithTimeout(urlValidation, request, origin, requestId);
          },
        });
      },
      OPTIONS: ({ request }) => proxyPolicy.options(request),
    },
  },
});
