import { env } from "cloudflare:workers";
import { AppError } from "@avoid.quest/error";
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getSessionId } from "@/lib/auth/session";
import { logAuthFailure, logRateLimitViolation } from "@/lib/logger";
import {
  checkRateLimit,
  getClientIP,
  resolveRateLimitSubject,
} from "@/lib/rate-limit";

async function getOrCreateSession(
  cookieHeader: string | null,
  createIfMissing: boolean
): Promise<{ sessionId: string | null; shouldSetCookie: boolean }> {
  if (createIfMissing) {
    const { getOrCreateSessionFromRequest } = await import(
      "@/lib/middleware/session-creation"
    );
    return getOrCreateSessionFromRequest(cookieHeader);
  }
  return { sessionId: getSessionId(cookieHeader), shouldSetCookie: false };
}

export function rateLimitMiddleware(
  identifier: string,
  options?: { createSessionIfMissing?: boolean }
) {
  const createSessionIfMissing = options?.createSessionIfMissing ?? true;

  return createMiddleware({ type: "function" }).server(async ({ next }) => {
    const request = getRequest();
    const ip = getClientIP(request);
    const cookieHeader = request.headers.get("cookie");

    const { sessionId, shouldSetCookie } = await getOrCreateSession(
      cookieHeader,
      createSessionIfMissing
    );

    if (!(sessionId || createSessionIfMissing)) {
      logAuthFailure(identifier);
      throw new AppError({
        category: "auth",
        code: "UNAUTHORIZED",
        safeMessage: "Unauthorized",
      });
    }

    const rateLimitSubject = resolveRateLimitSubject(request);
    const rateLimitResult = await checkRateLimit(
      env,
      identifier,
      rateLimitSubject
    );

    if (!rateLimitResult.allowed) {
      logRateLimitViolation(sessionId ?? "anonymous", identifier);
      throw new AppError({
        category: "rate_limit",
        code: "RATE_LIMITED",
        safeMessage: "Rate limit exceeded",
      });
    }

    const result = await next({
      context: {
        ip,
        sessionId,
        shouldSetCookie,
      },
    });

    return result;
  });
}

export function authMiddleware(options?: { createSessionIfMissing?: boolean }) {
  const createSessionIfMissing = options?.createSessionIfMissing ?? true;

  return createMiddleware({ type: "function" }).server(async ({ next }) => {
    const request = getRequest();
    const ip = getClientIP(request);
    const cookieHeader = request.headers.get("cookie");

    const { sessionId, shouldSetCookie } = await getOrCreateSession(
      cookieHeader,
      createSessionIfMissing
    );

    if (!(sessionId || createSessionIfMissing)) {
      logAuthFailure("auth");
      throw new AppError({
        category: "auth",
        code: "UNAUTHORIZED",
        safeMessage: "Unauthorized",
      });
    }

    return next({
      context: {
        ip,
        sessionId,
        shouldSetCookie,
      },
    });
  });
}
