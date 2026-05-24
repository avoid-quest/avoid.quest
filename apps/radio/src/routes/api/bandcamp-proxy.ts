/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { AppError, captureError } from "@avoid.quest/error";
import { createFileRoute } from "@tanstack/react-router";
import {
  cancelUpstreamBody,
  createBandcampProxyRequestHeaders,
  validateBandcampCdnUrl,
} from "@/lib/proxy/bandcamp-proxy";
import { createProxyRequestPolicy } from "@/lib/proxy/request-policy";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_SIZE = 100 * 1024 * 1024;

const proxyPolicy = createProxyRequestPolicy();

function validateUrl(
  urlParam: string | null,
  origin: string,
  requestId: string
): string | Response {
  const urlValidation = validateBandcampCdnUrl(urlParam);
  if (!urlValidation.ok) {
    const errorByReason = {
      required: {
        code: "BANDCAMP_PROXY_URL_REQUIRED",
        safeMessage: "URL parameter is required",
        category: "validation" as const,
        status: 400,
      },
      "invalid-url": {
        code: "BANDCAMP_PROXY_INVALID_URL",
        safeMessage: "Invalid URL format",
        category: "validation" as const,
        status: 400,
      },
      "invalid-protocol": {
        code: "BANDCAMP_PROXY_INVALID_PROTOCOL",
        safeMessage: "Invalid URL: must use http or https protocol",
        category: "validation" as const,
        status: 400,
      },
      "invalid-domain": {
        code: "BANDCAMP_PROXY_INVALID_DOMAIN",
        safeMessage: "Invalid URL: must be a Bandcamp CDN URL",
        category: "validation" as const,
        status: 400,
      },
    }[urlValidation.reason];

    return proxyPolicy.problem(
      new AppError({
        ...errorByReason,
        expected: true,
      }),
      origin,
      requestId
    );
  }

  return urlValidation.url;
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
    const res = await fetch(url, {
      signal: controller.signal,
      headers: createBandcampProxyRequestHeaders(request),
    });

    clearTimeout(timeout);

    if (!res.ok) {
      await cancelUpstreamBody(res);
      return proxyPolicy.problem(
        new AppError({
          code: "BANDCAMP_PROXY_UPSTREAM_ERROR",
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
        await cancelUpstreamBody(res);
        return proxyPolicy.problem(
          new AppError({
            code: "BANDCAMP_PROXY_RESPONSE_TOO_LARGE",
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
          code: "BANDCAMP_PROXY_TIMEOUT",
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
      code: "BANDCAMP_PROXY_FETCH_FAILED",
      safeMessage: "Failed to fetch stream",
      category: "network",
      expected: false,
      status: 500,
    });

    captureError(error instanceof AppError ? error : appError, {
      surface: "api-route",
      operation: "bandcamp-proxy.fetch",
      requestId,
    });

    return proxyPolicy.problem(appError, origin, requestId);
  }
}

export const Route = createFileRoute("/api/bandcamp-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        proxyPolicy.run({
          request,
          env,
          identifier: "bandcamp-proxy",
          operation: "bandcamp-proxy.GET",
          fallback: {
            code: "BANDCAMP_PROXY_INTERNAL_ERROR",
            safeMessage: "Internal server error",
            category: "infrastructure",
            expected: false,
            status: 500,
          },
          run: async ({ origin, request, requestId }) => {
            const urlParam = new URL(request.url).searchParams.get("url");
            const urlValidation = validateUrl(urlParam, origin, requestId);
            if (urlValidation instanceof Response) {
              return urlValidation;
            }

            return fetchWithTimeout(urlValidation, request, origin, requestId);
          },
        }),
      OPTIONS: ({ request }) => proxyPolicy.options(request),
    },
  },
});
