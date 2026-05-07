import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const feedbackHandlerMock = mock(async (_request: Request) =>
  Response.json({ ok: true })
);
const createFeedbackEndpointMock = mock((_options: unknown) => {
  return feedbackHandlerMock;
});

mock.module("git-feedback/server", () => ({
  createFeedbackEndpoint: createFeedbackEndpointMock,
}));
mock.module("@/lib/logger", () => ({
  logAuthFailure: mock(() => undefined),
  logRateLimitViolation: mock(() => undefined),
  logSecurityEvent: mock(() => undefined),
  logSSRFAttempt: mock(() => undefined),
}));

let handleFeedbackRequest: typeof import("./endpoint")["handleFeedbackRequest"];

beforeAll(async () => {
  ({ handleFeedbackRequest } = await import("./endpoint"));
});

beforeEach(() => {
  feedbackHandlerMock.mockClear();
  createFeedbackEndpointMock.mockClear();
});

describe("handleFeedbackRequest", () => {
  test("returns capabilities for GET requests without rate limiting", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: true,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      method: "GET",
    });

    const response = await handleFeedbackRequest(request, {
      GIT_FEEDBACK_GITHUB_TOKEN: "token",
      "proxy-rate-limit": { limit: limitMock },
    });

    expect(response.status).toBe(200);
    expect(limitMock).not.toHaveBeenCalled();
    expect(feedbackHandlerMock).toHaveBeenCalledTimes(1);
  });

  test("rate limits feedback by session ID", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: true,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      method: "POST",
      headers: {
        cookie: "radio_session_id=test-session-123",
      },
    });

    const response = await handleFeedbackRequest(request, {
      GIT_FEEDBACK_GITHUB_TOKEN: "token",
      "proxy-rate-limit": { limit: limitMock },
    });

    expect(response.status).toBe(200);
    expect(limitMock).toHaveBeenCalledWith({
      key: "feedback:test-session-123",
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

  test("creates session and sets cookie for anonymous feedback", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: true,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      method: "POST",
    });

    const response = await handleFeedbackRequest(request, {
      GIT_FEEDBACK_GITHUB_TOKEN: "token",
      "proxy-rate-limit": { limit: limitMock },
    });

    expect(response.status).toBe(200);
    expect(limitMock).toHaveBeenCalledTimes(1);
    const rateLimitKey = (limitMock.mock.calls[0]?.[0] as { key: string }).key;
    expect(rateLimitKey).toStartWith("feedback:");
    expect(response.headers.get("set-cookie")).toStartWith("radio_session_id=");
  });

  test("returns 429 when feedback rate limit is exceeded", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: false,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      method: "POST",
      headers: {
        cookie: "radio_session_id=test-session",
      },
    });

    const response = await handleFeedbackRequest(request, {
      GIT_FEEDBACK_GITHUB_TOKEN: "token",
      "proxy-rate-limit": { limit: limitMock },
    });

    expect(response.status).toBe(429);
    expect(feedbackHandlerMock).not.toHaveBeenCalled();
  });

  test("formats contact email and mode into readable issue sections", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: true,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      method: "POST",
    });

    await handleFeedbackRequest(request, {
      GIT_FEEDBACK_GITHUB_TOKEN: "token",
      "proxy-rate-limit": { limit: limitMock },
    });

    const endpointOptions = createFeedbackEndpointMock.mock.calls[0]?.[0] as {
      issue?: {
        formatter?: (item: {
          body: string;
          category?: string;
          pageUrl?: string;
          untrustedMetadata?: Record<string, string>;
          userAgent?: string;
        }) => { body?: string };
      };
    };
    const formatted = endpointOptions.issue?.formatter?.({
      body: "The deck meter stopped moving.",
      category: "bug",
      pageUrl: "https://radio.test/",
      untrustedMetadata: {
        contactEmail: "listener@example.com",
        mode: "dj",
      },
      userAgent: "Test Browser",
    });

    expect(formatted?.body).toContain("## Contact");
    expect(formatted?.body).toContain("- Email: listener@example.com");
    expect(formatted?.body).toContain("## Context");
    expect(formatted?.body).toContain("| Category | Bug report |");
    expect(formatted?.body).toContain("| Mode | DJ |");
    expect(formatted?.body).toContain("<summary>Details</summary>");
    expect(formatted?.body).toContain("- App version: v");
  });
});
