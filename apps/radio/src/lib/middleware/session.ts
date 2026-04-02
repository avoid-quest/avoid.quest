const SESSION_COOKIE_NAME = "radio_session_id";
// Aligned with current proxy rate-limit window in apps/radio/wrangler.jsonc (period: 10s)
const SESSION_COOKIE_MAX_AGE_SECONDS = 10;

/**
 * Create a secure session cookie string.
 */
export function createSessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`;
}

/**
 * Attach session cookie to response when required.
 */
export function attachSessionCookie(
  response: Response,
  sessionId: string,
  shouldSetCookie: boolean
): Response {
  if (!shouldSetCookie) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", createSessionCookie(sessionId));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
