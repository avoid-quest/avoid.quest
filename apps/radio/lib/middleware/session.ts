import { randomBytes } from "node:crypto";
import { getSessionId } from "@/lib/auth/session";

const SESSION_COOKIE_NAME = "radio_session_id";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * Generate a secure random session ID
 */
function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Create a session cookie string
 * @param sessionId - The session ID
 * @returns Cookie string
 */
export function createSessionCookie(sessionId: string): string {
  const isProduction = process.env.NODE_ENV === "production";
  const secure = isProduction ? "Secure; " : "";
  return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax; ${secure}`;
}

/**
 * Get or create session ID from request cookies.
 * Creates a new session if one doesn't exist.
 * @param cookieHeader - The Cookie header value from the request
 * @returns Object with sessionId and shouldSetCookie flag
 */
export async function getOrCreateSessionFromRequest(
  cookieHeader: string | null
): Promise<{ sessionId: string; shouldSetCookie: boolean }> {
  let sessionId = await getSessionId(cookieHeader);
  let shouldSetCookie = false;

  if (!sessionId) {
    sessionId = generateSessionId();
    shouldSetCookie = true;
  }

  return { sessionId, shouldSetCookie };
}

