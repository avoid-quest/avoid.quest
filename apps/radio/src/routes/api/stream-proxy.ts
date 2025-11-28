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

const MAX_RESPONSE_SIZE = 100 * 1024 * 1024; // 100MB
const FETCH_TIMEOUT_MS = 30_000; // 30 seconds for radio streams

// Known problematic domains that need proxying
const PROXY_DOMAINS = ["radioking.com", "pantano.ovh"];

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

  // Only allow known problematic domains
  const isAllowedDomain = PROXY_DOMAINS.some((domain) =>
    urlParam.includes(domain)
  );

  if (!isAllowedDomain) {
    return json(
      { error: "Invalid domain: not a supported proxy domain" },
      { status: 400, headers: getCorsHeaders(origin) }
    );
  }

  return urlParam;
}

function buildFetchHeaders(request: Request): HeadersInit {
  const rangeHeader = request.headers.get("range");
  const headers: HeadersInit = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };

  if (rangeHeader) {
    headers.Range = rangeHeader;
  }

  return headers;
}

function buildResponseHeaders(res: Response, origin: string): HeadersInit {
  const contentType = res.headers.get("Content-Type") || "audio/mpeg";
  const headers: HeadersInit = {
    ...getCorsHeaders(origin),
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };

  const length = res.headers.get("Content-Length");
  const range = res.headers.get("Content-Range");
  if (length) {
    headers["Content-Length"] = length;
  }
  if (range) {
    headers["Content-Range"] = range;
  }

  return headers;
}

function handleInternalFetchError(
  url: string,
  errorMsg: string,
  origin: string,
  timeout: ReturnType<typeof setTimeout>
): Response {
  console.error(
    `[stream-proxy] Internal fetch error (possibly port/SSL issue) for ${url}:`,
    errorMsg
  );
  clearTimeout(timeout);
  return json(
    {
      error:
        "Failed to connect to stream server. This may be due to network restrictions or server configuration.",
      details:
        "The stream server may not be accessible from this environment, or there may be SSL/TLS or port restrictions.",
    },
    { status: 502, headers: getCorsHeaders(origin) }
  );
}

function validateResponseSize(
  contentLength: string | null,
  origin: string
): Response | null {
  if (!contentLength) {
    return null;
  }

  const size = Number.parseInt(contentLength, 10);
  if (size > MAX_RESPONSE_SIZE) {
    return json(
      { error: "Response too large" },
      { status: 413, headers: getCorsHeaders(origin) }
    );
  }

  return null;
}

function handleFetchError(
  error: unknown,
  url: string,
  origin: string,
  timeout: ReturnType<typeof setTimeout>
): Response {
  clearTimeout(timeout);

  let errorMessage = "Failed to fetch stream";
  let errorDetails: unknown = error;

  if (error instanceof Error) {
    errorMessage = error.message;
    errorDetails = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };

    if (error.name === "AbortError") {
      console.error(`[stream-proxy] Request timeout for ${url}`);
      return json(
        { error: "Request timeout" },
        { status: 408, headers: getCorsHeaders(origin) }
      );
    }
  }

  console.error(
    `[stream-proxy] Stream proxy error for ${url}:`,
    errorMessage,
    errorDetails
  );

  return json(
    {
      error: `Failed to fetch stream: ${errorMessage}`,
      url,
    },
    { status: 500, headers: getCorsHeaders(origin) }
  );
}

async function fetchStream(
  url: string,
  request: Request,
  origin: string
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    console.log(`[stream-proxy] Fetching stream from: ${url}`);

    // Parse URL to check for potential issues
    let urlObj: URL;
    try {
      urlObj = new URL(url);
      console.log(
        `[stream-proxy] URL parsed - protocol: ${urlObj.protocol}, host: ${urlObj.host}, port: ${urlObj.port}`
      );
    } catch (urlError) {
      console.error(`[stream-proxy] Failed to parse URL: ${url}`, urlError);
      clearTimeout(timeout);
      return json(
        { error: "Invalid URL format" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const fetchHeaders = buildFetchHeaders(request);

    // Try fetch with minimal options first
    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: fetchHeaders,
        redirect: "follow",
      });
    } catch (fetchError) {
      const errorMsg =
        fetchError instanceof Error ? fetchError.message : String(fetchError);

      if (errorMsg.includes("internal error")) {
        return handleInternalFetchError(url, errorMsg, origin, timeout);
      }
      // Re-throw other errors to be caught by outer catch
      throw fetchError;
    }

    clearTimeout(timeout);

    if (!res.ok && res.status !== 206) {
      console.error(
        `[stream-proxy] Stream fetch failed: ${res.status} ${res.statusText} for ${url}`
      );
      return json(
        { error: `Failed to fetch stream: ${res.statusText}` },
        { status: res.status, headers: getCorsHeaders(origin) }
      );
    }

    const contentLength = res.headers.get("Content-Length");
    const sizeError = validateResponseSize(contentLength, origin);
    if (sizeError) {
      return sizeError;
    }

    const contentType = res.headers.get("Content-Type") || "audio/mpeg";
    console.log(
      `[stream-proxy] Stream response: ${res.status}, Content-Type: ${contentType}`
    );

    const responseHeaders = buildResponseHeaders(res, origin);

    return new Response(res.body, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return handleFetchError(error, url, origin, timeout);
  }
}

export const Route = createFileRoute("/api/stream-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        try {
          const authResult = await validateAuthAndRateLimit(
            request,
            env,
            "stream-proxy",
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

          return fetchStream(urlValidation, request, origin);
        } catch (error) {
          // Enhanced error logging for debugging
          let errorMessage = "Internal server error";
          let errorDetails: unknown = error;

          if (error instanceof Error) {
            errorMessage = error.message;
            errorDetails = {
              name: error.name,
              message: error.message,
              stack: error.stack,
              cause: error.cause,
            };
          }

          console.error(
            "[stream-proxy] Handler error:",
            errorMessage,
            errorDetails
          );

          return json(
            {
              error: "Internal server error",
              details: errorMessage, // Include details for debugging
            },
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
