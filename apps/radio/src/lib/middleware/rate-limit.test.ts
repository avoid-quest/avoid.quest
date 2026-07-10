import { beforeAll, describe, expect, mock, test } from "bun:test";

const logAuthFailureMock = mock(() => undefined);
const logRateLimitViolationMock = mock(() => undefined);

mock.module("@/lib/logger", () => ({
  logAuthFailure: logAuthFailureMock,
  logRateLimitViolation: logRateLimitViolationMock,
  logSecurityEvent: mock(() => undefined),
  logSSRFAttempt: mock(() => undefined),
}));

const VALID_SESSION_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let getClientIP: typeof import("./rate-limit")["getClientIP"];
let validateAuthAndRateLimit: typeof import("./rate-limit")["validateAuthAndRateLimit"];

beforeAll(async () => {
  ({ getClientIP, validateAuthAndRateLimit } = await import("./rate-limit"));
});

describe("validateAuthAndRateLimit", () => {
  test("uses the Cloudflare client IP for rate-limit keys before session cookies", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: true,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        cookie: `radio_session_id=${VALID_SESSION_ID}`,
        "x-forwarded-for": "198.51.100.20",
      },
    });

    const result = await validateAuthAndRateLimit(
      request,
      { "proxy-rate-limit": { limit: limitMock } },
      "feedback",
      { createSessionIfMissing: true }
    );

    expect(result).not.toBeInstanceOf(Response);
    expect(limitMock).toHaveBeenCalledWith({
      key: "feedback:ip:203.0.113.10",
    });
  });

  test("does not use a syntactically valid session cookie when Cloudflare IP is unavailable", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: true,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      headers: {
        cookie: `radio_session_id=${VALID_SESSION_ID}`,
        "x-forwarded-for": "198.51.100.20",
      },
    });

    const result = await validateAuthAndRateLimit(
      request,
      { "proxy-rate-limit": { limit: limitMock } },
      "feedback",
      { createSessionIfMissing: true }
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(429);
    expect(limitMock).not.toHaveBeenCalled();
  });

  test("fails closed when no trusted IP can key the limit", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: true,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      headers: {
        cookie: "radio_session_id=client-controlled",
      },
    });

    const result = await validateAuthAndRateLimit(
      request,
      { "proxy-rate-limit": { limit: limitMock } },
      "feedback",
      { createSessionIfMissing: true }
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(429);
    expect(limitMock).not.toHaveBeenCalled();
  });

  test("fails closed when cookies are omitted and Cloudflare IP is unavailable", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: true,
    }));
    const request = new Request("https://radio.test/api/feedback");

    const result = await validateAuthAndRateLimit(
      request,
      { "proxy-rate-limit": { limit: limitMock } },
      "feedback",
      { createSessionIfMissing: true }
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(429);
    expect(limitMock).not.toHaveBeenCalled();
  });
});

describe("getClientIP", () => {
  test("prefers Cloudflare client IP before x-forwarded-for", () => {
    const request = new Request("https://radio.test/api/feedback", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": "198.51.100.20, 198.51.100.21",
      },
    });

    expect(getClientIP(request)).toBe("203.0.113.10");
  });
});
