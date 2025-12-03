const SESSION_COOKIE_NAME = "radio_session_id";

/**
 * Get session ID from cookies (for API routes).
 * Returns null if no session exists.
 * @param cookieHeader - The Cookie header value from the request
 * @returns The session ID or null
 */
export function getSessionId(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookieList = cookieHeader.split(";").map((c) => c.trim());
  const sessionCookie = cookieList.find((c) =>
    c.startsWith(`${SESSION_COOKIE_NAME}=`)
  );

  if (!sessionCookie) {
    return null;
  }

  const sessionId = sessionCookie.split("=")[1];
  return sessionId || null;
}
