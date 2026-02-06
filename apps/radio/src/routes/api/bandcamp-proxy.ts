/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
// biome-ignore lint/performance/noNamespaceImport: namespace import required for Sentry
import * as Sentry from "@sentry/tanstackstart-react";
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
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds
const MAX_RESPONSE_SIZE = 100 * 1024 * 1024; // 100MB

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

  if (!urlParam.includes("bcbits.com")) {
    return json(
      { error: "Invalid URL: must be a Bandcamp CDN URL" },
      { status: 400, headers: getCorsHeaders(origin) }
    );
  }

  return urlParam;
}

async function fetchWithTimeout(
  url: string,
  request: Request,
  origin: string
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Range: request.headers.get("range") || "",
        Referer: "https://bandcamp.com/",
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return json(
        { error: `Failed to fetch stream: ${res.statusText}` },
        { status: res.status, headers: getCorsHeaders(origin) }
      );
    }

    const contentLength = res.headers.get("Content-Length");
    if (contentLength) {
      const size = Number.parseInt(contentLength, 10);
      if (size > MAX_RESPONSE_SIZE) {
        return json(
          { error: "Response too large" },
          { status: 413, headers: getCorsHeaders(origin) }
        );
      }
    }

    const headers: HeadersInit = {
      ...getCorsHeaders(origin),
      "Content-Type": res.headers.get("Content-Type") || "audio/mpeg",
      "Accept-Ranges": "bytes",
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
      return json(
        { error: "Request timeout" },
        { status: 408, headers: getCorsHeaders(origin) }
      );
    }
    return json(
      { error: "Failed to fetch stream" },
      { status: 500, headers: getCorsHeaders(origin) }
    );
  }
}

export const Route = createFileRoute("/api/bandcamp-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const origin = new URL(request.url).origin;

          // Validate authentication and rate limiting (creates session if missing for audio element requests)
          const authResult = await validateAuthAndRateLimit(
            request,
            env,
            "bandcamp-proxy",
            {
              createSessionIfMissing: true,
            }
          );
          if (authResult instanceof Response) {
            return authResult;
          }

          const urlParam = new URL(request.url).searchParams.get("url");
          const urlValidation = validateUrl(urlParam, origin);
          if (urlValidation instanceof Response) {
            return urlValidation;
          }

          return fetchWithTimeout(urlValidation, request, origin);
        } catch (error) {
          Sentry.captureException(error);
          const origin = new URL(request.url).origin;
          const errorMessage =
            error instanceof Error ? error.message : "Internal server error";
          console.error("Bandcamp proxy error:", errorMessage, error);
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
