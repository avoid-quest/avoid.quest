import { NextResponse } from "next/server";
import { z } from "zod";
import { getBandcampItem } from "@/lib/external-url/bandcamp";
import { detectPlatformFromUrl } from "@/lib/external-url/detect";
import { getSoundCloudItem } from "@/lib/external-url/soundcloud";
import type { PlatformItemResponse } from "@/lib/external-url/types";
import { getCorsHeaders, getCorsOptionsHeaders } from "@/lib/middleware/cors";
import { validateAuthAndRateLimit } from "@/lib/middleware/rate-limit";
import { createSessionCookie } from "@/lib/middleware/session";

const REQUEST_BODY_SCHEMA = z.object({
  url: z.string(),
});

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

function getResponseHeaders(
  origin: string,
  shouldSetCookie: boolean,
  sessionId: string
): Record<string, string> {
  const headers = getCorsHeaders(origin);
  if (shouldSetCookie) {
    headers["Set-Cookie"] = createSessionCookie(sessionId);
  }
  return headers;
}

export async function POST(request: Request) {
  let origin = "*";
  try {
    origin = new URL(request.url).origin;
  } catch {
    // Fallback if URL parsing fails
  }

  try {
    // Validate authentication and rate limiting (creates session if missing)
    const authResult = await validateAuthAndRateLimit(
      request,
      "load-platform-item"
    );
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { sessionId, shouldSetCookie } = authResult;

    const body = await request.json();
    const bodyValidation = REQUEST_BODY_SCHEMA.safeParse(body);

    if (!bodyValidation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        {
          status: 400,
          headers: getResponseHeaders(origin, shouldSetCookie, sessionId),
        }
      );
    }

    const { url } = bodyValidation.data;

    // Input validation
    if (!url.trim()) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid URL" },
        {
          status: 400,
          headers: getResponseHeaders(origin, shouldSetCookie, sessionId),
        }
      );
    }

    const trimmedUrl = url.trim();

    // Validate URL format with Zod
    const urlValidation = URL_SCHEMA.safeParse(trimmedUrl);
    if (!urlValidation.success) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid URL format. Please enter a valid URL (max 2048 characters).",
        },
        {
          status: 400,
          headers: getResponseHeaders(origin, shouldSetCookie, sessionId),
        }
      );
    }

    const platform = detectPlatformFromUrl(trimmedUrl);

    if (!platform) {
      return NextResponse.json(
        {
          success: false,
          error: "Unsupported URL. Please enter a Bandcamp or SoundCloud URL.",
        },
        {
          status: 400,
          headers: getResponseHeaders(origin, shouldSetCookie, sessionId),
        }
      );
    }

    let result: PlatformItemResponse;

    if (platform === "bandcamp") {
      result = await getBandcampItem(trimmedUrl);
    } else if (platform === "soundcloud") {
      result = await getSoundCloudItem(trimmedUrl);
    } else {
      return NextResponse.json(
        { success: false, error: "Unsupported platform" },
        {
          status: 400,
          headers: getResponseHeaders(origin, shouldSetCookie, sessionId),
        }
      );
    }

    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
      headers: getResponseHeaders(origin, shouldSetCookie, sessionId),
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error("Load platform item error:", errorMessage, error);
    return NextResponse.json(
      { success: false, error: `Failed to process request: ${errorMessage}` },
      {
        status: 500,
        headers: getCorsHeaders(origin),
      }
    );
  }
}

export function OPTIONS(request: Request) {
  const origin = new URL(request.url).origin;
  return new NextResponse(null, {
    status: 200,
    headers: getCorsOptionsHeaders(origin),
  });
}
