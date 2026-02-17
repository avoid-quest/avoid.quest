import { describe, expect, test } from "bun:test";
import {
  AppError,
  buildPlaybackEventKey,
  captureError,
  capturePlaybackError,
  createDedupeStore,
  createRequestId,
  isAbortPlaybackError,
  problemJson,
  runApiRoute,
  shouldCapturePlaybackError,
  shouldReportToSentry,
  toAppError,
} from "./index";

describe("AppError", () => {
  test("creates default severity and status from category", () => {
    const error = new AppError({
      code: "RATE_LIMITED",
      safeMessage: "Too many requests",
      category: "rate_limit",
    });

    expect(error.severity).toBe("warning");
    expect(error.status).toBe(429);
    expect(error.expected).toBe(true);
  });

  test("normalizes unknown errors using fallback", () => {
    const normalized = toAppError("boom", {
      code: "UNKNOWN",
      safeMessage: "Unexpected",
      category: "unknown",
      severity: "error",
      expected: false,
      status: 500,
    });

    expect(normalized).toBeInstanceOf(AppError);
    expect(normalized.code).toBe("UNKNOWN");
  });

  test("falls back to default safe message when empty", () => {
    const error = new AppError({
      code: "EMPTY_MESSAGE",
      safeMessage: "   ",
      category: "unknown",
    });

    expect(error.safeMessage).toBe("Something went wrong. Please try again.");
    expect(error.message).toBe("Something went wrong. Please try again.");
  });
});

describe("reporting policy", () => {
  test("does not report expected warning errors", () => {
    const error = new AppError({
      code: "INVALID_INPUT",
      safeMessage: "Bad input",
      category: "validation",
      expected: true,
    });

    expect(shouldReportToSentry(error)).toBe(false);
  });

  test("reports expected critical errors", () => {
    const error = new AppError({
      code: "SECURITY_BLOCK",
      safeMessage: "Blocked",
      category: "security",
      expected: true,
      severity: "critical",
    });

    expect(shouldReportToSentry(error)).toBe(true);
  });
});

describe("problem payload", () => {
  test("returns safe payload shape", () => {
    const payload = problemJson(
      new AppError({
        code: "NETWORK_DOWN",
        safeMessage: "Network unavailable",
        category: "network",
      }),
      "req-1"
    );

    expect(payload).toEqual({
      code: "NETWORK_DOWN",
      message: "Network unavailable",
      requestId: "req-1",
      status: 502,
    });
  });
});

describe("request id", () => {
  test("uses incoming x-request-id when present", () => {
    const request = new Request("https://example.com", {
      headers: { "x-request-id": "abc123" },
    });

    expect(createRequestId(request)).toBe("abc123");
  });
});

describe("api route wrapper", () => {
  test("propagates request id header on success", async () => {
    const request = new Request("https://example.com/api/test", {
      headers: { "x-request-id": "req-success-123" },
    });

    const response = await runApiRoute({
      request,
      operation: "api.test",
      run: async () => new Response(null, { status: 204 }),
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("x-request-id")).toBe("req-success-123");
  });

  test("returns standardized problem payload on thrown errors", async () => {
    const request = new Request("https://example.com/api/test");

    const response = await runApiRoute({
      request,
      operation: "api.test",
      fallback: {
        code: "API_TEST_FAILED",
        safeMessage: "Operation failed",
        category: "dependency",
        expected: false,
        status: 502,
      },
      errorHeaders: { "x-test-header": "1" },
      run: () => Promise.reject(new Error("boom")),
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("x-test-header")).toBe("1");

    const payload = (await response.json()) as {
      code: string;
      message: string;
      requestId: string;
      status: number;
    };

    expect(payload.code).toBe("API_TEST_FAILED");
    expect(payload.message).toBe("Operation failed");
    expect(payload.status).toBe(502);
    expect(payload.requestId.length).toBeGreaterThan(0);
    expect(response.headers.get("x-request-id")).toBe(payload.requestId);
  });
});

describe("dedupe", () => {
  test("suppresses repeated keys within ttl", () => {
    let now = 1000;
    const dedupe = createDedupeStore(500, () => now);

    expect(dedupe.hasSeen("key")).toBe(false);
    expect(dedupe.hasSeen("key")).toBe(true);

    now = 1600;
    expect(dedupe.hasSeen("key")).toBe(false);
  });

  test("captureError dedupe key returns undefined on duplicate", () => {
    const baseError = new AppError({
      code: "PLAYBACK_FAIL",
      safeMessage: "Playback failed",
      category: "playback",
      expected: false,
    });

    const first = captureError(baseError, {
      operation: "playback",
      surface: "ui",
      dedupeKey: "dup-key",
    });

    const second = captureError(baseError, {
      operation: "playback",
      surface: "ui",
      dedupeKey: "dup-key",
    });

    expect(second).toBeUndefined();
    // First may be undefined in tests without Sentry init, but must not throw.
    expect(first === undefined || typeof first === "string").toBe(true);
  });
});

describe("playback helpers", () => {
  test("captures only actionable playback codes", () => {
    expect(shouldCapturePlaybackError("MEDIA_ERROR_4")).toBe(true);
    expect(shouldCapturePlaybackError("SINGLE_PLAY_FAILED")).toBe(true);
    expect(shouldCapturePlaybackError("UNKNOWN")).toBe(false);
  });

  test("builds stable playback keys", () => {
    const key = buildPlaybackEventKey({
      mode: "single",
      errorCode: "MEDIA_ERROR_4",
      errorMessage: "Unsupported stream format for this browser",
      streamUrl: "https://example.test/live",
    });

    expect(key).toContain("single");
    expect(key).toContain("MEDIA_ERROR_4");
    expect(key).toContain("example.test");
    expect(key).not.toContain("https://example.test/live");
  });

  test("buildPlaybackEventKey normalizes empty messages", () => {
    const key = buildPlaybackEventKey({
      mode: "single",
      errorCode: "MEDIA_ERROR_4",
      errorMessage: "   ",
      streamUrl: "https://example.test/live",
    });

    expect(key).toContain("something went wrong. please try again.");
  });

  test("detects abort playback errors by error name", () => {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";

    expect(isAbortPlaybackError(error, error.message)).toBe(true);
  });

  test("detects abort playback errors by message text", () => {
    expect(
      isAbortPlaybackError(
        new Error("some wrapper"),
        "The operation was aborted."
      )
    ).toBe(true);
  });

  test("capturePlaybackError dedupes repeats", () => {
    const payload = {
      mode: "single" as const,
      errorCode: "MEDIA_ERROR_4",
      errorMessage: "Unsupported stream format for this browser",
      streamUrl: "https://example.test/live",
    };

    const first = capturePlaybackError(
      new Error(payload.errorMessage),
      payload
    );
    const second = capturePlaybackError(
      new Error(payload.errorMessage),
      payload
    );

    expect(second).toBeUndefined();
    expect(first === undefined || typeof first === "string").toBe(true);
  });
});
