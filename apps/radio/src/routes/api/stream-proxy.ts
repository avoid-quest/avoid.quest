/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { AppError, captureError } from "@avoid.quest/error";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createProxyRequestPolicy } from "@/lib/proxy/request-policy";
import { inspectStreamAccess } from "@/lib/proxy/stream-access";

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

const proxyPolicy = createProxyRequestPolicy();

/**
 * Validate URL is a streaming URL (http/https protocol)
 */
function validateUrl(
  urlParam: string | null,
  origin: string,
  requestId: string
): string | Response {
  if (!urlParam) {
    return proxyPolicy.problem(
      new AppError({
        code: "STREAM_PROXY_URL_REQUIRED",
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
        code: "STREAM_PROXY_INVALID_URL",
        safeMessage: "Invalid URL format",
        category: "validation",
        expected: true,
        status: 400,
      }),
      origin,
      requestId
    );
  }

  const parsed = new URL(urlParam);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return proxyPolicy.problem(
      new AppError({
        code: "STREAM_PROXY_INVALID_PROTOCOL",
        safeMessage: "Invalid URL: must use http or https protocol",
        category: "validation",
        expected: true,
        status: 400,
      }),
      origin,
      requestId
    );
  }

  // SSRF protection: block internal/private addresses
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("172.16.") ||
    hostname.startsWith("172.17.") ||
    hostname.startsWith("172.18.") ||
    hostname.startsWith("172.19.") ||
    hostname.startsWith("172.20.") ||
    hostname.startsWith("172.21.") ||
    hostname.startsWith("172.22.") ||
    hostname.startsWith("172.23.") ||
    hostname.startsWith("172.24.") ||
    hostname.startsWith("172.25.") ||
    hostname.startsWith("172.26.") ||
    hostname.startsWith("172.27.") ||
    hostname.startsWith("172.28.") ||
    hostname.startsWith("172.29.") ||
    hostname.startsWith("172.30.") ||
    hostname.startsWith("172.31.") ||
    hostname.startsWith("169.254.") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:") ||
    hostname.endsWith(".onion") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal" ||
    // IPv4-mapped IPv6 addresses
    hostname.startsWith("::ffff:127.") ||
    hostname.startsWith("::ffff:10.") ||
    hostname.startsWith("::ffff:192.168.") ||
    hostname.startsWith("::ffff:172.16.") ||
    hostname.startsWith("::ffff:172.17.") ||
    hostname.startsWith("::ffff:172.18.") ||
    hostname.startsWith("::ffff:172.19.") ||
    hostname.startsWith("::ffff:172.20.") ||
    hostname.startsWith("::ffff:172.21.") ||
    hostname.startsWith("::ffff:172.22.") ||
    hostname.startsWith("::ffff:172.23.") ||
    hostname.startsWith("::ffff:172.24.") ||
    hostname.startsWith("::ffff:172.25.") ||
    hostname.startsWith("::ffff:172.26.") ||
    hostname.startsWith("::ffff:172.27.") ||
    hostname.startsWith("::ffff:172.28.") ||
    hostname.startsWith("::ffff:172.29.") ||
    hostname.startsWith("::ffff:172.30.") ||
    hostname.startsWith("::ffff:172.31.") ||
    hostname.startsWith("::ffff:169.254.")
  ) {
    return proxyPolicy.problem(
      new AppError({
        code: "STREAM_PROXY_INTERNAL_ADDRESS",
        safeMessage: "Internal addresses not allowed",
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

/**
 * Fetch stream and pipe response with CORS headers
 * Uses streaming response body for efficient proxying
 */
function buildStreamResponse(
  upstreamResponse: Response,
  request: Request,
  requestId: string
): Response {
  const responseHeaders: HeadersInit = {
    ...proxyPolicy.errorHeaders(request),
    "Access-Control-Expose-Headers":
      "Content-Type, Content-Length, Icy-MetaInt, Icy-Name, Icy-Description, Icy-Genre, Icy-Br",
    "x-request-id": requestId,
  };

  const contentType = upstreamResponse.headers.get("Content-Type");
  if (contentType) {
    responseHeaders["Content-Type"] = contentType;
  }

  const contentLength = upstreamResponse.headers.get("Content-Length");
  if (contentLength) {
    responseHeaders["Content-Length"] = contentLength;
  }

  for (const header of [
    "Icy-MetaInt",
    "Icy-Name",
    "Icy-Description",
    "Icy-Genre",
    "Icy-Br",
  ]) {
    const value = upstreamResponse.headers.get(header);
    if (value) {
      responseHeaders[header] = value;
    }
  }

  const contentRange = upstreamResponse.headers.get("Content-Range");
  if (contentRange) {
    responseHeaders["Content-Range"] = contentRange;
    responseHeaders["Accept-Ranges"] = "bytes";
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

async function fetchStream(
  url: string,
  request: Request,
  origin: string,
  requestId: string
): Promise<Response> {
  try {
    const headers: HeadersInit = {
      "Icy-MetaData": request.headers.get("Icy-MetaData") || "0",
    };

    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      return proxyPolicy.problem(
        new AppError({
          code: "STREAM_PROXY_UPSTREAM_ERROR",
          safeMessage: `Upstream error: ${res.status} ${res.statusText}`,
          category: "dependency",
          expected: false,
          status: res.status,
          tags: { upstreamStatus: res.status },
        }),
        origin,
        requestId
      );
    }

    return buildStreamResponse(res, request, requestId);
  } catch (error) {
    const appError = new AppError({
      code: "STREAM_PROXY_FETCH_FAILED",
      safeMessage: "Failed to fetch stream",
      category: "network",
      expected: false,
      status: 502,
    });

    captureError(error instanceof AppError ? error : appError, {
      surface: "api-route",
      operation: "stream-proxy.fetchStream",
      requestId,
      tags: { endpoint: "stream-proxy" },
    });

    return proxyPolicy.problem(appError, origin, requestId);
  }
}

function redirectToStream(
  url: string,
  request: Request,
  requestId: string
): Response {
  const headers = new Headers(proxyPolicy.errorHeaders(request));
  headers.set("Cache-Control", "private, no-store");
  headers.set("Location", url);
  headers.set("x-request-id", requestId);

  return new Response(null, {
    status: 307,
    headers,
  });
}

export const Route = createFileRoute("/api/stream-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return proxyPolicy.run({
          request,
          env,
          identifier: "stream-proxy",
          operation: "stream-proxy.GET",
          fallback: {
            code: "STREAM_PROXY_INTERNAL_ERROR",
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

            const accessDecision = await inspectStreamAccess(urlValidation, {
              origin,
            });
            if (accessDecision.mode === "direct") {
              return redirectToStream(
                accessDecision.resolvedUrl ?? urlValidation,
                request,
                requestId
              );
            }

            if (accessDecision.response?.ok) {
              return buildStreamResponse(
                accessDecision.response,
                request,
                requestId
              );
            }

            return fetchStream(urlValidation, request, origin, requestId);
          },
        });
      },
      OPTIONS: ({ request }) => proxyPolicy.options(request),
    },
  },
});
