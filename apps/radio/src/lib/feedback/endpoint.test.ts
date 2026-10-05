import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const feedbackHandlerMock = mock(async (_request: Request) =>
  Response.json({ ok: true })
);
const createFeedbackEndpointMock = mock(
  (_options: unknown) => feedbackHandlerMock
);
const createIssueMock = mock(async () => ({
  id: "1",
  title: "Feedback",
  url: "https://github.test/issue/1",
}));
const createGitHubAdapterMock = mock((_options: unknown) => ({
  createIssue: createIssueMock,
}));

mock.module("git-feedback/github", () => ({
  createGitHubAdapter: createGitHubAdapterMock,
}));
mock.module("git-feedback/server", () => ({
  createFeedbackEndpoint: createFeedbackEndpointMock,
}));
mock.module("@/lib/logger", () => ({
  logAuthFailure: mock(() => undefined),
  logRateLimitViolation: mock(() => undefined),
  logSecurityEvent: mock(() => undefined),
  logSSRFAttempt: mock(() => undefined),
}));

const VALID_SESSION_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let handleFeedbackRequest: typeof import("./endpoint")["handleFeedbackRequest"];

beforeAll(async () => {
  ({ handleFeedbackRequest } = await import("./endpoint"));
});

beforeEach(() => {
  createGitHubAdapterMock.mockClear();
  createIssueMock.mockClear();
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

  test("rate limits feedback by Cloudflare IP", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: true,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        cookie: `radio_session_id=${VALID_SESSION_ID}`,
      },
      method: "POST",
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
        adapter: expect.objectContaining({ createIssue: createIssueMock }),
      })
    );
    expect(createGitHubAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.objectContaining({
          rest: expect.objectContaining({
            issues: expect.objectContaining({ create: expect.any(Function) }),
          }),
        }),
        customizeIssueInput: expect.any(Function),
        input: {
          labels: ["git-feedback", "radio"],
          owner: "avoid-quest",
          repo: "avoid.quest",
        },
      })
    );

    const githubOptions = createGitHubAdapterMock.mock.calls[0]?.[0] as {
      customizeIssueInput: (
        input: { labels?: string[] },
        context: { issue: { category?: string } }
      ) => { labels?: string[] };
    };
    expect(
      githubOptions.customizeIssueInput(
        { labels: ["git-feedback", "radio"] },
        { issue: { category: "bug" } }
      ).labels
    ).toEqual(["git-feedback", "radio", "bug"]);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("creates session and sets cookie for anonymous feedback", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: true,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
      },
      method: "POST",
    });

    const response = await handleFeedbackRequest(request, {
      GIT_FEEDBACK_GITHUB_TOKEN: "token",
      "proxy-rate-limit": { limit: limitMock },
    });

    expect(response.status).toBe(200);
    expect(limitMock).toHaveBeenCalledWith({
      key: "feedback:ip:203.0.113.10",
    });
    expect(response.headers.get("set-cookie")).toStartWith("radio_session_id=");
  });

  test("returns 429 when feedback rate limit is exceeded", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: false,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
      },
      method: "POST",
    });

    const response = await handleFeedbackRequest(request, {
      GIT_FEEDBACK_GITHUB_TOKEN: "token",
      "proxy-rate-limit": { limit: limitMock },
    });

    expect(response.status).toBe(429);
    expect(feedbackHandlerMock).not.toHaveBeenCalled();
  });

  test("excludes legacy contact email while preserving non-sensitive context", async () => {
    const limitMock = mock(async (_options: { key: string }) => ({
      success: true,
    }));
    const request = new Request("https://radio.test/api/feedback", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
      },
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
      pageUrl: "https://radio.test/?email=listener@example.com#private",
      untrustedMetadata: {
        contactEmail: "listener@example.com",
        mode: "dj",
      },
      userAgent: "Test Browser",
    });

    expect(formatted?.body).not.toContain("## Contact");
    expect(JSON.stringify(formatted)).not.toContain("listener@example.com");
    expect(formatted?.body).toContain("- Page URL: https://radio.test/");
    expect(createFeedbackEndpointMock.mock.calls[0]?.[0]).toMatchObject({
      logger: false,
    });
    expect(formatted?.body).toContain("## Context");
    expect(formatted?.body).toContain("| Category | Bug report |");
    expect(formatted?.body).toContain("| Mode | DJ |");
    expect(formatted?.body).toContain("<summary>Details</summary>");
    expect(formatted?.body).toContain("- App version: v");
  });

  test("labels node and the retired multiple and treats garbage modes as Unknown", async () => {
    const request = new Request("https://radio.test/api/feedback", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
      },
      method: "POST",
    });

    await handleFeedbackRequest(request, {
      GIT_FEEDBACK_GITHUB_TOKEN: "token",
      "proxy-rate-limit": { limit: async () => ({ success: true }) },
    });

    const endpointOptions = createFeedbackEndpointMock.mock.calls[0]?.[0] as {
      issue?: {
        formatter?: (item: {
          body: string;
          untrustedMetadata?: Record<string, string>;
        }) => { body?: string };
      };
    };
    const modeRow = (mode?: string) =>
      endpointOptions.issue
        ?.formatter?.({
          body: "Feedback",
          untrustedMetadata: mode === undefined ? {} : { mode },
        })
        .body?.split("\n")
        .find((line) => line.startsWith("| Mode |"));

    expect(modeRow("node")).toBe("| Mode | Node |");
    expect(modeRow("single")).toBe("| Mode | Single |");
    // Retired, but named so triage can spot an outdated client.
    expect(modeRow("multiple")).toBe("| Mode | Multiple |");
    expect(modeRow("<script>|x")).toBe("| Mode | Unknown |");
    expect(modeRow("toString")).toBe("| Mode | Unknown |");
    expect(modeRow()).toBe("| Mode | Not provided |");
  });
});
