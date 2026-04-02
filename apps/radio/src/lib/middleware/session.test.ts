import { describe, expect, test } from "bun:test";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOrCreateSessionFromRequest } from "./session-creation";
import { attachSessionCookie } from "./session";

describe("session cookie middleware helpers", () => {
  test("first request without cookie => response includes Set-Cookie", () => {
    const session = getOrCreateSessionFromRequest(null);

    expect(session.shouldSetCookie).toBe(true);

    const baseResponse = new Response("ok", { status: 200 });
    const finalResponse = attachSessionCookie(
      baseResponse,
      session.sessionId,
      session.shouldSetCookie
    );

    const setCookie = finalResponse.headers.get("Set-Cookie");
    expect(setCookie).toContain("radio_session_id=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=10");
  });

  test("subsequent requests with cookie => no new Set-Cookie", () => {
    const existingSessionId = "existing-session-id";
    const session = getOrCreateSessionFromRequest(
      `radio_session_id=${existingSessionId}`
    );

    expect(session.sessionId).toBe(existingSessionId);
    expect(session.shouldSetCookie).toBe(false);

    const baseResponse = new Response("ok", { status: 200 });
    const finalResponse = attachSessionCookie(
      baseResponse,
      session.sessionId,
      session.shouldSetCookie
    );

    expect(finalResponse.headers.get("Set-Cookie")).toBeNull();
  });

  test("rate limit is applied on the same session", async () => {
    const seen = new Map<string, number>();
    const env = {
      "proxy-rate-limit": {
        limit: async ({ key }: { key: string }) => {
          const current = (seen.get(key) ?? 0) + 1;
          seen.set(key, current);
          return { success: current <= 1 };
        },
      },
    };

    const sessionId = "sticky-session";

    const first = await checkRateLimit(env, sessionId, "stream-proxy");
    const second = await checkRateLimit(env, sessionId, "stream-proxy");

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });
});
