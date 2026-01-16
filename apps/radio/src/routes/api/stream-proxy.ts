/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { z } from "zod";
import { getCorsHeaders, getCorsOptionsHeaders } from "@/lib/middleware/cors";
import { validateAuthAndRateLimit } from "@/lib/middleware/rate-limit";

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

/**
 * Validate URL is a streaming URL (http/https protocol)
 */
function validateUrl(
  urlParam: string | null,
  origin: string
): string | Response {
  if (!urlParam) {
    return json(
      { error: "URL parameter is required" },
      { status: 400, headers: getCorsHeaders(origin) }
    );
  }

  const urlValidation = URL_SCHEMA.safeParse(urlParam);
  if (!urlValidation.success) {
    return json(
      { error: "Invalid URL format" },
      { status: 400, headers: getCorsHeaders(origin) }
    );
  }

  // Validate protocol
  const parsed = new URL(urlParam);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return json(
      { error: "Invalid URL: must use http or https protocol" },
      { status: 400, headers: getCorsHeaders(origin) }
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
    hostname.startsWith("169.254.") || // Link-local
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("fc") || // IPv6 unique local (fc00::/7)
    hostname.startsWith("fd") || // IPv6 unique local (fc00::/7)
    hostname.startsWith("fe80:") // IPv6 link-local
  ) {
    return json(
      { error: "Internal addresses not allowed" },
      { status: 400, headers: getCorsHeaders(origin) }
    );
  }

  return urlParam;
}

/**
 * Fetch stream and pipe response with CORS headers
 * Uses streaming response body for efficient proxying
 */
async function fetchStream(
  url: string,
  request: Request,
  origin: string
): Promise<Response> {
  try {
    // Forward relevant headers from the original request
    const headers: HeadersInit = {
      // Request ICY metadata if client supports it
      "Icy-MetaData": request.headers.get("Icy-MetaData") || "0",
    };

    // Forward Range header for seeking support
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      return json(
        { error: `Upstream error: ${res.status} ${res.statusText}` },
        { status: res.status, headers: getCorsHeaders(origin) }
      );
    }

    // Build response headers with CORS
    const responseHeaders: HeadersInit = {
      ...getCorsHeaders(origin),
      // Expose ICY headers for metadata
      "Access-Control-Expose-Headers":
        "Content-Type, Content-Length, Icy-MetaInt, Icy-Name, Icy-Description, Icy-Genre, Icy-Br",
    };

    // Forward content type
    const contentType = res.headers.get("Content-Type");
    if (contentType) {
      responseHeaders["Content-Type"] = contentType;
    }

    // Forward content length if available
    const contentLength = res.headers.get("Content-Length");
    if (contentLength) {
      responseHeaders["Content-Length"] = contentLength;
    }

    // Forward ICY metadata headers (Icecast specific)
    for (const header of [
      "Icy-MetaInt",
      "Icy-Name",
      "Icy-Description",
      "Icy-Genre",
      "Icy-Br",
    ]) {
      const value = res.headers.get(header);
      if (value) {
        responseHeaders[header] = value;
      }
    }

    // Forward range response headers
    const contentRange = res.headers.get("Content-Range");
    if (contentRange) {
      responseHeaders["Content-Range"] = contentRange;
      responseHeaders["Accept-Ranges"] = "bytes";
    }

    // Stream the response body directly
    return new Response(res.body, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Stream proxy fetch error:", errorMessage);
    return json(
      { error: "Failed to fetch stream" },
      { status: 502, headers: getCorsHeaders(origin) }
    );
  }
}

export const Route = createFileRoute("/api/stream-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const origin = new URL(request.url).origin;

          // Validate authentication and rate limiting
          // Note: createSessionIfMissing=true allows anonymous stream proxy access
          // for DJ mode where user may not have an existing session
          const authResult = await validateAuthAndRateLimit(
            request,
            env,
            "stream-proxy",
            { createSessionIfMissing: true }
          );
          if (authResult instanceof Response) {
            return authResult;
          }

          const urlParam = new URL(request.url).searchParams.get("url");
          const urlValidation = validateUrl(urlParam, origin);
          if (urlValidation instanceof Response) {
            return urlValidation;
          }

          return fetchStream(urlValidation, request, origin);
        } catch (error) {
          const origin = new URL(request.url).origin;
          const errorMessage =
            error instanceof Error ? error.message : "Internal server error";
          console.error("Stream proxy error:", errorMessage, error);
          return json(
            { error: "Internal server error" },
            { status: 500, headers: getCorsHeaders(origin) }
          );
        }
      },
      OPTIONS: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return new Response(null, {
          status: 200,
          headers: getCorsOptionsHeaders(origin),
        });
      },
    },
  },
});
