import { getSessionId } from "@/lib/auth/session";
import { logAuthFailure, logRateLimitViolation } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { getCorsHeaders } from "./cors";
import { json } from "@tanstack/react-start";

/**
 * Get client IP from request headers
 * @param request - The request object
 * @returns Client IP or undefined
 */
export function getClientIP(request: Request): string | undefined {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    undefined
  );
}

export type AuthAndRateLimitResult = 
  | { sessionId: string; ip: string | undefined; shouldSetCookie: boolean }
  | Response;

/**
 * Validate authentication and rate limiting for API routes
 * @param request - The request object
 * @param env - The Cloudflare environment bindings
 * @param identifier - Unique identifier for this rate limit (e.g., 'soundcloud-proxy')
 * @param options - Options for validation
 * @param options.createSessionIfMissing - Whether to create a session if one doesn't exist (default: true)
 * @returns Either session info or a Response error
 */
export async function validateAuthAndRateLimit(
  request: Request,
  env: { "proxy-rate-limit"?: { limit: (options: { key: string }) => Promise<{ success: boolean }> } },
  identifier: string,
  options?: { createSessionIfMissing?: boolean }
): Promise<AuthAndRateLimitResult> {
  let origin = "*";
  try {
    origin = new URL(request.url).origin;
  } catch {
    // Fallback if URL parsing fails
  }

  const ip = getClientIP(request);
  const cookieHeader = request.headers.get("cookie");
  const createSessionIfMissing = options?.createSessionIfMissing ?? true;

  let sessionId: string | null;
  let shouldSetCookie = false;

  try {
    if (createSessionIfMissing) {
      // Get or create session
      const { getOrCreateSessionFromRequest } = await import("./session");
      const result = await getOrCreateSessionFromRequest(cookieHeader);
      sessionId = result.sessionId;
      shouldSetCookie = result.shouldSetCookie;
    } else {
      // Require existing session
      sessionId = await getSessionId(cookieHeader);
      if (!sessionId) {
        logAuthFailure(identifier, ip);
        return json(
          { error: "Unauthorized" },
          { status: 401, headers: getCorsHeaders(origin) }
        );
      }
    }

    // Check rate limit
    const rateLimitResult = await checkRateLimit(env, sessionId, identifier);

    if (!rateLimitResult.allowed) {
      logRateLimitViolation(sessionId, identifier, ip);
      return json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: getCorsHeaders(origin) }
      );
    }

    return { sessionId, ip, shouldSetCookie };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("validateAuthAndRateLimit error:", errorMessage, error);
    // Fail closed - return unauthorized on error
    return json(
      { error: "Authentication failed" },
      { status: 500, headers: getCorsHeaders(origin) }
    );
  }
}
