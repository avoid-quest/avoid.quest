import { AppError, problemResponse } from "@avoid.quest/error";
import { getSessionId } from "@/lib/auth/session";
import { logAuthFailure, logRateLimitViolation } from "@/lib/logger";
import {
  checkRateLimit,
  type RateLimitEnv,
  getClientIP as readClientIP,
  resolveRateLimitSubject,
} from "@/lib/rate-limit";
import { getCorsHeaders } from "./cors";

/**
 * Get client IP from request headers
 * @param request - The request object
 * @returns Client IP or undefined
 */
export function getClientIP(request: Request): string | undefined {
  return readClientIP(request);
}

export type AuthAndRateLimitResult =
  | { sessionId: string; ip: string | undefined; shouldSetCookie: boolean }
  | Response;

/**
 * Validate authentication and rate limiting for API routes
 * @param request - The request object
 * @param env - The Cloudflare environment bindings
 * @param identifier - Unique identifier for this rate limit (e.g., 'radio-metadata')
 * @param options - Options for validation
 * @param options.createSessionIfMissing - Whether to create a session if one doesn't exist (default: true)
 * @returns Either session info or a Response error
 */
export async function validateAuthAndRateLimit(
  request: Request,
  env: RateLimitEnv,
  identifier: string,
  options?: { createSessionIfMissing?: boolean; requestId?: string }
): Promise<AuthAndRateLimitResult> {
  let origin = "*";
  try {
    ({ origin } = new URL(request.url));
  } catch {
    // Fallback if URL parsing fails
  }

  const ip = getClientIP(request);
  const cookieHeader = request.headers.get("cookie");
  const createSessionIfMissing = options?.createSessionIfMissing ?? true;
  const requestId = options?.requestId;

  let sessionId: string | null;
  let shouldSetCookie = false;

  try {
    if (createSessionIfMissing) {
      // Get or create session (dynamic import to avoid bundling when not needed)
      const { getOrCreateSessionFromRequest } = await import(
        "./session-creation"
      );
      ({ sessionId, shouldSetCookie } =
        getOrCreateSessionFromRequest(cookieHeader));
    } else {
      // Require existing session
      sessionId = getSessionId(cookieHeader);
      if (!sessionId) {
        logAuthFailure(identifier, ip);
        return problemResponse(
          new AppError({
            category: "auth",
            code: "UNAUTHORIZED",
            expected: true,
            safeMessage: "Unauthorized",
            status: 401,
          }),
          {
            headers: getCorsHeaders(origin),
            requestId,
          }
        );
      }
    }

    // Check rate limit
    const rateLimitSubject = resolveRateLimitSubject(request);
    const rateLimitResult = await checkRateLimit(
      env,
      identifier,
      rateLimitSubject
    );

    if (!rateLimitResult.allowed) {
      logRateLimitViolation(sessionId, identifier, ip);
      return problemResponse(
        new AppError({
          category: "rate_limit",
          code: "RATE_LIMITED",
          expected: true,
          safeMessage: "Rate limit exceeded",
          status: 429,
        }),
        {
          headers: getCorsHeaders(origin),
          requestId,
        }
      );
    }

    return { ip, sessionId, shouldSetCookie };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("validateAuthAndRateLimit error:", errorMessage, error);
    // Fail closed - return unauthorized on error
    return problemResponse(
      new AppError({
        category: "infrastructure",
        code: "AUTHENTICATION_FAILED",
        expected: false,
        safeMessage: "Authentication failed",
        status: 500,
      }),
      {
        headers: getCorsHeaders(origin),
        requestId,
      }
    );
  }
}
