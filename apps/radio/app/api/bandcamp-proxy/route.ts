import { NextResponse } from "next/server";
import { z } from "zod";
import { getCorsHeaders, getCorsOptionsHeaders } from "@/lib/middleware/cors";
import { validateAuthAndRateLimit } from "@/lib/middleware/rate-limit";

export const runtime = "nodejs";

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
): string | NextResponse {
  if (!urlParam) {
    return NextResponse.json(
      { error: "URL parameter is required" },
      { status: 400, headers: getCorsHeaders(origin) }
    ) as unknown as string;
  }

  const urlValidation = URL_SCHEMA.safeParse(urlParam);
  if (!urlValidation.success) {
    return NextResponse.json(
      { error: "Invalid URL format" },
      { status: 400, headers: getCorsHeaders(origin) }
    ) as unknown as string;
  }

  if (!urlParam.includes("bcbits.com")) {
    return NextResponse.json(
      { error: "Invalid URL: must be a Bandcamp CDN URL" },
      { status: 400, headers: getCorsHeaders(origin) }
    ) as unknown as string;
  }

  return urlParam;
}

async function fetchWithTimeout(
  url: string,
  request: Request,
  origin: string
): Promise<NextResponse> {
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
      return NextResponse.json(
        { error: `Failed to fetch stream: ${res.statusText}` },
        { status: res.status, headers: getCorsHeaders(origin) }
      );
    }

    const contentLength = res.headers.get("Content-Length");
    if (contentLength) {
      const size = Number.parseInt(contentLength, 10);
      if (size > MAX_RESPONSE_SIZE) {
        return NextResponse.json(
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

    return new NextResponse(res.body, { status: res.status, headers });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Request timeout" },
        { status: 408, headers: getCorsHeaders(origin) }
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch stream" },
      { status: 500, headers: getCorsHeaders(origin) }
    );
  }
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;

  // Validate authentication and rate limiting (requires existing session)
  const authResult = await validateAuthAndRateLimit(request, "bandcamp-proxy", {
    createSessionIfMissing: false,
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const urlParam = new URL(request.url).searchParams.get("url");
  const urlValidation = validateUrl(urlParam, origin);
  if (urlValidation instanceof NextResponse) {
    return urlValidation;
  }

  return fetchWithTimeout(urlValidation, request, origin);
}

export function OPTIONS(request: Request) {
  const origin = new URL(request.url).origin;
  return new NextResponse(null, {
    status: 200,
    headers: getCorsOptionsHeaders(origin),
  });
}
