import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const feedbackHandlerMock = mock(async (_request: Request) =>
  Response.json({ ok: true })
);
const createFeedbackEndpointMock = mock((_options: unknown) => {
  return feedbackHandlerMock;
});
const logRateLimitViolationMock = mock(
  (_sessionId: string, _endpoint: string, _ip?: string) => undefined
);

mock.module("git-feedback/server", () => ({
  createFeedbackEndpoint: createFeedbackEndpointMock,
}));
mock.module("@/lib/logger", () => ({
  logAuthFailure: mock((_endpoint: string, _ip?: string) => undefined),
  logRateLimitViolation: logRateLimitViolationMock,
  logSecurityEvent: mock(
    (_level: string, _message: string, _context?: unknown) => undefined
  ),
  logSSRFAttempt: mock(
    (
      _sessionId: string,
      _attemptedUrl: string,
      _endpoint: string,
      _ip?: string
    ) => undefined
  ),
}));

let handleFeedbackRequest: typeof import("./endpoint")["handleFeedbackRequest"];

beforeAll(async () => {
  ({ handleFeedbackRequest } = await import("./endpoint"));
});

beforeEach(() => {
  feedbackHandlerMock.mockClear();
  createFeedbackEndpointMock.mockClear();
  logRateLimitViolationMock.mockClear();
});

describe("handleFeedbackRequest", () => {
  test("rate limits feedback by Cloudflare client IP instead of client-controlled session cookie", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: true,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      method: "POST",
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        cookie: "radio_session_id=attacker-controlled",
      },
    });

    const response = await handleFeedbackRequest(request, {
      GIT_FEEDBACK_GITHUB_TOKEN: "token",
      "proxy-rate-limit": { limit: limitMock },
    });

    expect(response.status).toBe(200);
    expect(limitMock).toHaveBeenCalledWith({
      key: "feedback:ip:203.0.113.10",
    });
    expect(createFeedbackEndpointMock).toHaveBeenCalledWith(
      expect.objectContaining({
        github: expect.objectContaining({
          repository: "avoid-quest/avoid.quest",
        }),
      })
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("does not trust forwarded-for as the feedback limiter key", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: true,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      method: "POST",
      headers: {
        "x-forwarded-for": "198.51.100.20",
      },
    });

    const response = await handleFeedbackRequest(request, {
      GIT_FEEDBACK_GITHUB_TOKEN: "token",
      "proxy-rate-limit": { limit: limitMock },
    });

    expect(response.status).toBe(200);
    expect(limitMock).toHaveBeenCalledWith({ key: "feedback:ip:unknown" });
    expect(response.headers.get("set-cookie")).toStartWith("radio_session_id=");
  });

  test("reports rate-limit violations with the same non-cookie limiter subject", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: false,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      method: "POST",
      headers: {
        "cf-connecting-ip": "203.0.113.44",
        cookie: "radio_session_id=rotated-cookie",
      },
    });

    const response = await handleFeedbackRequest(request, {
      GIT_FEEDBACK_GITHUB_TOKEN: "token",
      "proxy-rate-limit": { limit: limitMock },
    });

    expect(response.status).toBe(429);
    expect(logRateLimitViolationMock).toHaveBeenCalledWith(
      "ip:203.0.113.44",
      "feedback",
      "203.0.113.44"
    );
    expect(feedbackHandlerMock).not.toHaveBeenCalled();
  });
});
