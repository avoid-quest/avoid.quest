import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionId } from "@/lib/auth/session";
import { getBandcampItem } from "@/lib/external-url/bandcamp";
import { detectPlatformFromUrl } from "@/lib/external-url/detect";
import { getSoundCloudItem } from "@/lib/external-url/soundcloud";
import type { PlatformItemResponse } from "@/lib/external-url/types";
import { logRateLimitViolation } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";

const SESSION_COOKIE_NAME = "radio_session_id";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

type RateLimit = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export const runtime = "nodejs";

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

function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

function getCorsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function createSessionCookie(sessionId: string): string {
  const isProduction = process.env.NODE_ENV === "production";
  const secure = isProduction ? "Secure; " : "";
  return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax; ${secure}`;
}

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

function getClientIP(request: Request): string | undefined {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    undefined
  );
}

async function validateAuthAndRateLimit(
  request: Request,
  origin: string
): Promise<
  | { sessionId: string; ip: string | undefined; shouldSetCookie: boolean }
  | NextResponse
> {
  const ip = getClientIP(request);
  const cookieHeader = request.headers.get("cookie");
  let sessionId = await getSessionId(cookieHeader);
  let shouldSetCookie = false;

  // Create session if it doesn't exist (similar to getOrCreateSession)
  if (!sessionId) {
    sessionId = generateSessionId();
    shouldSetCookie = true;
  }

  const env = process.env as unknown as { RATE_LIMIT?: RateLimit };
  const rateLimitResult = await checkRateLimit(
    env.RATE_LIMIT,
    sessionId,
    "load-platform-item",
    {
      limit: 50, // 50 requests
      window: 60, // per minute
    }
  );

  if (!rateLimitResult.allowed) {
    logRateLimitViolation(sessionId, "load-platform-item", ip);
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: getCorsHeaders(origin) }
    );
  }

  return { sessionId, ip, shouldSetCookie };
}

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;

  const authResult = await validateAuthAndRateLimit(request, origin);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { sessionId, shouldSetCookie } = authResult;

  try {
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
    return NextResponse.json(
      { success: false, error: `Failed to process request: ${errorMessage}` },
      {
        status: 500,
        headers: getResponseHeaders(origin, shouldSetCookie, sessionId),
      }
    );
  }
}

export function OPTIONS(request: Request) {
  const origin = new URL(request.url).origin;
  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(origin),
  });
}
