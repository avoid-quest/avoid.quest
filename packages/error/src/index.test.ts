import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: namespace required to spy on the Sentry integration
import * as Sentry from "@sentry/core";
import {
  AppError,
  buildPlaybackEventKey,
  captureError,
  capturePlaybackError,
  createDedupeStore,
  createRequestId,
  isAbortPlaybackError,
  makeSentryOptions,
  problemJson,
  runApiRoute,
  shouldCapturePlaybackError,
  shouldReportToSentry,
  toAppError,
} from "./index";

const EVENT_ID = "1234567890abcdef1234567890abcdef";
let captureException: ReturnType<
  typeof spyOn<typeof Sentry, "captureException">
>;
let capturedScope: ReturnType<Sentry.Scope["getScopeData"]> | undefined;

beforeEach(() => {
  capturedScope = undefined;
  // Keep real scope handling, but never initialize a client or send telemetry.
  captureException = spyOn(Sentry, "captureException").mockImplementation(
    () => {
      capturedScope = Sentry.getCurrentScope().getScopeData();
      return EVENT_ID;
    }
  );
});

afterEach(() => {
  captureException.mockRestore();
});

describe("Sentry privacy configuration", () => {
  test("disables automatic IP collection and private request data", () => {
    const collection = makeSentryOptions({
      dsn: "https://publicKey@o123.ingest.us.sentry.io/42",
      environment: "test",
      release: "radio@test",
    }).dataCollection;
    const ipFilter = {
      deny: [
        "forwarded",
        "-ip",
        "remote-",
        "via",
        "-user",
        "referer",
        "referrer",
      ],
    };
    expect(collection.userInfo).toBe(false);
    expect(collection.cookies).toBe(false);
    expect(collection.httpBodies).toEqual([]);
    expect(collection.httpHeaders).toEqual({
      request: ipFilter,
      response: ipFilter,
    });
    expect(collection.urlQueryParams).toBe(false);
  });
});

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
  test("reports an unexpected error with its capture metadata", () => {
    const error = new AppError({
      category: "dependency",
      code: "DEPENDENCY_FAILED",
      expected: false,
      safeMessage: "Service unavailable",
    });

    expect(
      captureError(error, {
        fingerprint: ["dependency", "test"],
        operation: "api.test",
        requestId: "req-reportable",
        surface: "api-route",
      })
    ).toBe(EVENT_ID);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error);
    expect(capturedScope?.tags).toMatchObject({
      error_category: "dependency",
      error_code: "DEPENDENCY_FAILED",
      error_expected: "false",
      error_severity: "error",
      operation: "api.test",
      request_id: "req-reportable",
      surface: "api-route",
    });
    expect(capturedScope?.contexts).toMatchObject({
      app_error: {
        category: "dependency",
        code: "DEPENDENCY_FAILED",
        expected: false,
        severity: "error",
        status: 502,
      },
      request: { id: "req-reportable" },
    });
    expect(capturedScope?.fingerprint).toEqual(["dependency", "test"]);
  });

  test.each(["validation", "auth", "rate_limit", "dependency"] as const)(
    "does not emit expected %s errors",
    (category) => {
      const error = new AppError({
        category,
        code: "EXPECTED_FAILURE",
        expected: true,
        safeMessage: "Expected failure",
      });

      expect(shouldReportToSentry(error)).toBe(false);
      expect(
        captureError(error, { operation: "test", surface: "ui" })
      ).toBeUndefined();
      expect(captureException).not.toHaveBeenCalled();
    }
  );

  test.each([
    { category: "dependency", severity: "critical" },
    { category: "security", severity: "warning" },
    { category: "infrastructure", severity: "warning" },
  ] as const)(
    "emits expected $category errors with $severity severity",
    ({ category, severity }) => {
      const error = new AppError({
        category,
        code: "EXPECTED_REPORTABLE_FAILURE",
        expected: true,
        safeMessage: "Expected reportable failure",
        severity,
      });

      expect(shouldReportToSentry(error)).toBe(true);
      expect(captureError(error, { operation: "test", surface: "ui" })).toBe(
        EVENT_ID
      );
      expect(captureException).toHaveBeenCalledTimes(1);
      expect(captureException).toHaveBeenCalledWith(error);
    }
  );
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

  test("captureError emits the first report and suppresses its duplicate key", () => {
    const baseError = new AppError({
      category: "playback",
      code: "PLAYBACK_FAIL",
      expected: false,
      safeMessage: "Playback failed",
    });

    const meta = {
      dedupeKey: crypto.randomUUID(),
      operation: "playback",
      surface: "ui" as const,
    };

    expect(captureError(baseError, meta)).toBe(EVENT_ID);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(baseError);

    expect(
      captureError(
        new AppError({
          category: "playback",
          code: "PLAYBACK_RETRY_FAILED",
          expected: false,
          safeMessage: "Retry failed",
        }),
        meta
      )
    ).toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
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

  test("capturePlaybackError emits the first report and suppresses the same mode and host", () => {
    const streamHost = `${crypto.randomUUID()}.example.test`;
    const payload = {
      errorCode: "MEDIA_ERROR_4",
      errorMessage: "Unsupported stream format for this browser",
      mode: "single" as const,
      streamUrl: `https://${streamHost}/private-stream-path?session=synthetic#synthetic-fragment`,
    };
    const error = new Error(payload.errorMessage);

    expect(capturePlaybackError(error, payload)).toBe(EVENT_ID);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "playback",
        cause: error,
        code: "MEDIA_ERROR_4",
        expected: false,
        message: payload.errorMessage,
        severity: "error",
      })
    );
    expect(capturedScope?.tags).toMatchObject({
      feature: "radio-playback",
      mode: "single",
      operation: "playback",
      retry_phase: "none",
      stream_host: streamHost,
      surface: "ui",
    });
    expect(capturedScope?.fingerprint).toEqual([
      "radio-playback",
      "single",
      "MEDIA_ERROR_4",
      streamHost,
    ]);
    const captureMetadata = JSON.stringify(capturedScope);
    expect(captureMetadata).not.toContain("private-stream-path");
    expect(captureMetadata).not.toContain("session=synthetic");
    expect(captureMetadata).not.toContain("synthetic-fragment");

    expect(
      capturePlaybackError(new Error("Fallback failed"), {
        ...payload,
        errorCode: "PLAYBACK_FALLBACK_FAILED",
        errorMessage: "Fallback failed",
        streamUrl: `https://${streamHost}/fallback`,
      })
    ).toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  test("capturePlaybackError does not emit non-actionable errors", () => {
    expect(
      capturePlaybackError(new Error("Unknown failure"), {
        errorCode: "UNKNOWN",
        errorMessage: "Unknown failure",
        mode: "single",
      })
    ).toBeUndefined();
    expect(captureException).not.toHaveBeenCalled();
  });

  test("capturePlaybackError does not emit abort errors", () => {
    const error = new Error("Playback cancelled");
    error.name = "AbortError";

    expect(
      capturePlaybackError(error, {
        errorCode: "SINGLE_PLAY_FAILED",
        errorMessage: error.message,
        mode: "single",
      })
    ).toBeUndefined();
    expect(captureException).not.toHaveBeenCalled();
  });

  test("capturePlaybackError does not emit aborted operations wrapped in another error", () => {
    expect(
      capturePlaybackError(new Error("Wrapped playback failure"), {
        errorCode: "SINGLE_PLAY_FAILED",
        errorMessage: "The operation was aborted.",
        mode: "single",
      })
    ).toBeUndefined();
    expect(captureException).not.toHaveBeenCalled();
  });
});
