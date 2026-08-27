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
      category: "rate_limit",
      code: "RATE_LIMITED",
      safeMessage: "Too many requests",
    });

    expect(error.severity).toBe("warning");
    expect(error.status).toBe(429);
    expect(error.expected).toBe(true);
  });

  test("normalizes unknown errors using fallback", () => {
    const normalized = toAppError("boom", {
      category: "unknown",
      code: "UNKNOWN",
      expected: false,
      safeMessage: "Unexpected",
      severity: "error",
      status: 500,
    });

    expect(normalized).toBeInstanceOf(AppError);
    expect(normalized.code).toBe("UNKNOWN");
  });

  test("falls back to default safe message when empty", () => {
    const error = new AppError({
      category: "unknown",
      code: "EMPTY_MESSAGE",
      safeMessage: "   ",
    });

    expect(error.safeMessage).toBe("Something went wrong. Please try again.");
    expect(error.message).toBe("Something went wrong. Please try again.");
  });
});

describe("reporting policy", () => {
  test("does not report expected warning errors", () => {
    const error = new AppError({
      category: "validation",
      code: "INVALID_INPUT",
      expected: true,
      safeMessage: "Bad input",
    });

    expect(shouldReportToSentry(error)).toBe(false);
  });

  test("reports expected critical errors", () => {
    const error = new AppError({
      category: "security",
      code: "SECURITY_BLOCK",
      expected: true,
      safeMessage: "Blocked",
      severity: "critical",
    });

    expect(shouldReportToSentry(error)).toBe(true);
  });
});

describe("problem payload", () => {
  test("returns safe payload shape", () => {
    const payload = problemJson(
      new AppError({
        category: "network",
        code: "NETWORK_DOWN",
        safeMessage: "Network unavailable",
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
      operation: "api.test",
      request,
      run: async () => new Response(null, { status: 204 }),
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("x-request-id")).toBe("req-success-123");
  });

  test("returns standardized problem payload on thrown errors", async () => {
    const request = new Request("https://example.com/api/test");

    const response = await runApiRoute({
      errorHeaders: { "x-test-header": "1" },
      fallback: {
        category: "dependency",
        code: "API_TEST_FAILED",
        expected: false,
        safeMessage: "Operation failed",
        status: 502,
      },
      operation: "api.test",
      request,
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
      category: "playback",
      code: "PLAYBACK_FAIL",
      expected: false,
      safeMessage: "Playback failed",
    });

    const first = captureError(baseError, {
      dedupeKey: "dup-key",
      operation: "playback",
      surface: "ui",
    });

    const second = captureError(baseError, {
      dedupeKey: "dup-key",
      operation: "playback",
      surface: "ui",
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

  test("builds stable playback keys from mode and host only", () => {
    const key = buildPlaybackEventKey({
      errorCode: "MEDIA_ERROR_4",
      errorMessage: "Unsupported stream format for this browser",
      mode: "single",
      streamUrl: "https://example.test/live",
    });

    expect(key).toBe("single|example.test");
  });

  test("dedupes errors with different errorCode but same mode and host", () => {
    const base = {
      errorMessage: "some error",
      mode: "single" as const,
      streamUrl: "https://example.test/live",
    };

    const key1 = buildPlaybackEventKey({ ...base, errorCode: "MEDIA_ERROR_4" });
    const key2 = buildPlaybackEventKey({
      ...base,
      errorCode: "PLAYBACK_FALLBACK_FAILED",
    });

    expect(key1).toBe(key2);
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
      errorCode: "MEDIA_ERROR_4",
      errorMessage: "Unsupported stream format for this browser",
      mode: "single" as const,
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
