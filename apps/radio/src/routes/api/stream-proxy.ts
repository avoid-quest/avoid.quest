/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import {
  AppError,
  captureError,
  createRequestId,
  problemResponse,
  runApiRoute,
} from "@avoid.quest/error";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getCorsHeaders, getCorsOptionsHeaders } from "@/lib/middleware/cors";
import { validateAuthAndRateLimit } from "@/lib/middleware/rate-limit";
import {
  fetchWithValidatedRedirects,
  getStreamProxyConfig,
  isAllowedByDomainPolicy,
  isBlockedHostname,
} from "./stream-proxy-security";

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

function problemWithCors(
  error: AppError,
  origin: string,
  requestId: string
): Response {
  return problemResponse(error, {
    requestId,
    headers: getCorsHeaders(origin),
  });
}

function validateParsedUrl(
  parsed: URL,
  origin: string,
  requestId: string,
  allowedDomains: string[]
): Response | null {
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return problemWithCors(
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

  if (isBlockedHostname(parsed.hostname)) {
    return problemWithCors(
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

  if (!isAllowedByDomainPolicy(parsed.hostname, allowedDomains)) {
    return problemWithCors(
      new AppError({
        code: "STREAM_PROXY_DOMAIN_NOT_ALLOWED",
        safeMessage: "Stream host is not in the allowed domain list",
        category: "security",
        expected: true,
        status: 403,
      }),
      origin,
      requestId
    );
  }

  return null;
}

/**
 * Validate URL is a streaming URL (http/https protocol)
 */
function validateUrl(
  urlParam: string | null,
  origin: string,
  requestId: string,
  allowedDomains: string[]
): string | Response {
  if (!urlParam) {
    return problemWithCors(
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
    return problemWithCors(
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
  const parsedValidation = validateParsedUrl(parsed, origin, requestId, allowedDomains);
  if (parsedValidation) {
    return parsedValidation;
  }

  return parsed.toString();
}

function applyStreamLimits(
  upstream: Response,
  requestId: string,
  maxStreamBytes: number,
  maxStreamDurationMs: number
): Response {
  if (!upstream.body) {
    return upstream;
  }

  const start = Date.now();
  let streamedBytes = 0;

  const limitedBody = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        streamedBytes += chunk.byteLength;

        if (streamedBytes > maxStreamBytes || Date.now() - start > maxStreamDurationMs) {
          controller.terminate();
          return;
        }

        controller.enqueue(chunk);
      },
    })
  );

  const headers = new Headers(upstream.headers);
  headers.set("x-request-id", requestId);
  return new Response(limitedBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

/**
 * Fetch stream and pipe response with CORS headers
 * Uses streaming response body for efficient proxying
 */
async function fetchStream(
  url: string,
  request: Request,
  origin: string,
  requestId: string,
  config: ReturnType<typeof getStreamProxyConfig>
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort("stream proxy upstream timeout");
  }, config.upstreamTimeoutMs);

  try {
    const headers: HeadersInit = {
      "Icy-MetaData": request.headers.get("Icy-MetaData") || "0",
    };

    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }

    const upstreamRes = await fetchWithValidatedRedirects(
      url,
      headers,
      controller.signal,
      config.allowedDomains
    );

    if (!upstreamRes.ok) {
      return problemWithCors(
        new AppError({
          code: "STREAM_PROXY_UPSTREAM_ERROR",
          safeMessage: `Upstream error: ${upstreamRes.status} ${upstreamRes.statusText}`,
          category: "dependency",
          expected: false,
          status: upstreamRes.status,
          tags: { upstreamStatus: upstreamRes.status },
        }),
        origin,
        requestId
      );
    }

    const responseHeaders: HeadersInit = {
      ...getCorsHeaders(origin),
      "Access-Control-Expose-Headers":
        "Content-Type, Content-Length, Icy-MetaInt, Icy-Name, Icy-Description, Icy-Genre, Icy-Br",
      "x-request-id": requestId,
    };

    const contentType = upstreamRes.headers.get("Content-Type");
    if (contentType) {
      responseHeaders["Content-Type"] = contentType;
    }

    const contentLength = upstreamRes.headers.get("Content-Length");
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
      const value = upstreamRes.headers.get(header);
      if (value) {
        responseHeaders[header] = value;
      }
    }

    const contentRange = upstreamRes.headers.get("Content-Range");
    if (contentRange) {
      responseHeaders["Content-Range"] = contentRange;
      responseHeaders["Accept-Ranges"] = "bytes";
    }

    return applyStreamLimits(
      new Response(upstreamRes.body, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: responseHeaders,
      }),
      requestId,
      config.maxStreamBytes,
      config.maxStreamDurationMs
    );
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError({
            code:
              error instanceof Error && error.name === "AbortError"
                ? "STREAM_PROXY_TIMEOUT"
                : "STREAM_PROXY_FETCH_FAILED",
            safeMessage:
              error instanceof Error && error.name === "AbortError"
                ? "Stream upstream timeout"
                : "Failed to fetch stream",
            category: "network",
            expected: false,
            status: 502,
          });

    captureError(appError, {
      surface: "api-route",
      operation: "stream-proxy.fetchStream",
      requestId,
      tags: { endpoint: "stream-proxy" },
    });

    return problemWithCors(appError, origin, requestId);
  } finally {
    clearTimeout(timeout);
  }
}

export const Route = createFileRoute("/api/stream-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return runApiRoute({
          request,
          operation: "stream-proxy.GET",
          fallback: {
            code: "STREAM_PROXY_INTERNAL_ERROR",
            safeMessage: "Internal server error",
            category: "infrastructure",
            expected: false,
            status: 500,
          },
          errorHeaders: () => {
            try {
              return getCorsHeaders(new URL(request.url).origin);
            } catch {
              return {};
            }
          },
          run: async ({ requestId }) => {
            const origin = new URL(request.url).origin;
            const config = getStreamProxyConfig(env);

            const authResult = await validateAuthAndRateLimit(
              request,
              env,
              "stream-proxy",
              { createSessionIfMissing: true, requestId }
            );
            if (authResult instanceof Response) {
              return authResult;
            }

            const urlParam = new URL(request.url).searchParams.get("url");
            const urlValidation = validateUrl(
              urlParam,
              origin,
              requestId,
              config.allowedDomains
            );
            if (urlValidation instanceof Response) {
              return urlValidation;
            }

            return fetchStream(urlValidation, request, origin, requestId, config);
          },
        });
      },
      OPTIONS: async ({ request }) => {
        const requestId = createRequestId(request);
        const origin = new URL(request.url).origin;
        const headers = new Headers(getCorsOptionsHeaders(origin));
        headers.set("x-request-id", requestId);

        return new Response(null, {
          status: 200,
          headers,
        });
      },
    },
  },
});

export const __private__ = { validateUrl };
