/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { z } from "zod";
import { logSSRFAttempt } from "@/lib/logger";
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

function validateYouTubeUrl(
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

  const isGooglevideo = urlObj.hostname.endsWith(".googlevideo.com");
  const isManifest = urlObj.hostname === "manifest.googlevideo.com";
  if (!(isGooglevideo || isManifest)) {
    logSSRFAttempt(sessionId, urlParam, "youtube-proxy", ip);
    return json(
      { error: "Invalid domain: not a YouTube stream domain" },
      { status: 400, headers: getCorsHeaders(origin) }
    );
  }

  return urlParam;
}

const ANDROID_USER_AGENT =
  "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

function getStreamHeaders(streamUrl: string): Record<string, string> {
  try {
    const params = new URL(streamUrl).searchParams;
    if (params.get("c") === "ANDROID") {
      return { "User-Agent": ANDROID_USER_AGENT };
    }
  } catch {
    // fall through
  }
  return {
    "User-Agent": BROWSER_USER_AGENT,
    Referer: "https://www.youtube.com/",
    Origin: "https://www.youtube.com",
  };
}

// Max chunk size per request — googlevideo.com blocks range requests larger
// than ~512KB for streams without n-parameter transformation.
const MAX_RANGE_CHUNK = 524_287; // 512KB - 1

function buildStreamResponse(res: Response, origin: string): Response {
  const headers: HeadersInit = {
    ...getCorsHeaders(origin),
    "Content-Type": res.headers.get("Content-Type") || "audio/webm",
    "Accept-Ranges": "bytes",
  };

  const length = res.headers.get("Content-Length");
  const contentRange = res.headers.get("Content-Range");
  if (length) {
    headers["Content-Length"] = length;
  }
  if (contentRange) {
    headers["Content-Range"] = contentRange;
  }

  return new Response(res.body, { status: res.status, headers });
}

async function fetchWithTimeout(
  url: string,
  request: Request,
  origin: string
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const clientRange = request.headers.get("range");
    const requestHeaders: HeadersInit = getStreamHeaders(url);

    // googlevideo.com rejects requests without a Range header (403) and
    // throttles/blocks ranges larger than ~512KB for streams without
    // n-parameter transformation. Always use a bounded initial range.
    requestHeaders.Range = clientRange || `bytes=0-${MAX_RANGE_CHUNK}`;

    const res = await fetch(url, {
      signal: controller.signal,
      headers: requestHeaders,
    });

    clearTimeout(timeout);

    if (!res.ok && res.status !== 206) {
      return json(
        { error: `Failed to fetch stream: ${res.status}` },
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

    return buildStreamResponse(res, origin);
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

export const Route = createFileRoute("/api/youtube-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const origin = new URL(request.url).origin;

          const authResult = await validateAuthAndRateLimit(
            request,
            env,
            "youtube-proxy",
            {
              createSessionIfMissing: true,
            }
          );
          if (authResult instanceof Response) {
            return authResult;
          }

          const urlParam = new URL(request.url).searchParams.get("url");
          const urlValidation = validateYouTubeUrl(
            urlParam,
            origin,
            authResult.sessionId,
            authResult.ip
          );
          if (urlValidation instanceof Response) {
            return urlValidation;
          }

          return fetchWithTimeout(urlValidation, request, origin);
        } catch {
          const origin = new URL(request.url).origin;
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
