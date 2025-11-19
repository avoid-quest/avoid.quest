const SESSION_COOKIE_NAME = "radio_session_id";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

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
