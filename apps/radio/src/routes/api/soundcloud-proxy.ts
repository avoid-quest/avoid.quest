/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { z } from "zod";
import { logSSRFAttempt } from "@/lib/logger";
import { getCorsHeaders, getCorsOptionsHeaders } from "@/lib/middleware/cors";
import { validateAuthAndRateLimit } from "@/lib/middleware/rate-limit";

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
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds
const MAX_RESPONSE_SIZE = 100 * 1024 * 1024; // 100MB

function validateSoundCloudUrl(
  urlParam: string | null,
  origin: string,
  sessionId: string,
  ip: string | undefined
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

  let urlObj: URL;
  try {
    urlObj = new URL(urlParam);
  } catch {
    return json(
      { error: "Invalid URL format" },
      { status: 400, headers: getCorsHeaders(origin) }
    );
  }

  if (
    urlObj.hostname === "soundcloud.com" ||
    urlObj.hostname === "www.soundcloud.com"
  ) {
    return json(
      { error: "Invalid URL: must be a stream URL, not a page URL" },
      { status: 400, headers: getCorsHeaders(origin) }
    );
  }

  if (
    !ALLOWED_SOUNDCLOUD_DOMAINS.includes(
      urlObj.hostname as (typeof ALLOWED_SOUNDCLOUD_DOMAINS)[number]
    )
  ) {
    logSSRFAttempt(sessionId, urlParam, "soundcloud-proxy", ip);
    return json(
      { error: "Invalid domain: not a SoundCloud CDN domain" },
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

export const Route = createFileRoute("/api/soundcloud-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const origin = new URL(request.url).origin;

          // Validate authentication and rate limiting (creates session if missing for audio element requests)
          const authResult = await validateAuthAndRateLimit(
            request,
            env,
            "soundcloud-proxy",
            {
              createSessionIfMissing: true,
            }
          );
          if (authResult instanceof Response) {
            return authResult;
          }

          const urlParam = new URL(request.url).searchParams.get("url");
          const urlValidation = validateSoundCloudUrl(
            urlParam,
            origin,
            authResult.sessionId,
            authResult.ip
          );
          if (urlValidation instanceof Response) {
            return urlValidation;
          }

          return fetchWithTimeout(urlValidation, request, origin);
        } catch (error) {
          const origin = new URL(request.url).origin;
          const errorMessage =
            error instanceof Error ? error.message : "Internal server error";
          console.error("SoundCloud proxy error:", errorMessage, error);
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
