import { randomBytes } from "node:crypto";
import { getSessionId } from "@/lib/auth/session";

/**
 * Generate a secure random session ID
 */
function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Get or create session ID from request cookies.
 * Creates a new session if one doesn't exist.
 * @param cookieHeader - The Cookie header value from the request
 * @returns Object with sessionId and shouldSetCookie flag
 */
export function getOrCreateSessionFromRequest(cookieHeader: string | null): {
  sessionId: string;
  shouldSetCookie: boolean;
} {
  let sessionId = getSessionId(cookieHeader);
  let shouldSetCookie = false;

  if (!sessionId) {
    sessionId = generateSessionId();
    shouldSetCookie = true;
  }

  return { sessionId, shouldSetCookie };
}
