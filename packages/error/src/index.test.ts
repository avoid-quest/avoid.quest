import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: namespace required to spy on the Sentry integration
import * as Sentry from "@sentry/core";
import {
  AppError,
  captureError,
  capturePlaybackError,
  createRequestId,
  filterSentryEvent,
  fromProblemError,
  isAbortPlaybackError,
  makeSentryOptions,
  problemJson,
  runApiRoute,
  runServerFn,
  shouldReportToSentry,
  toAppError,
} from "./index";

const PRIVATE_DATA = /private|session=|secret/;
const EVENT_ID = "1234567890abcdef1234567890abcdef";
let captureException: ReturnType<
  typeof spyOn<typeof Sentry, "captureException">
>;
let capturedScope: ReturnType<Sentry.Scope["getScopeData"]> | undefined;
let isEnabled: ReturnType<typeof spyOn<typeof Sentry, "isEnabled">>;

beforeEach(() => {
  capturedScope = undefined;
  isEnabled = spyOn(Sentry, "isEnabled").mockReturnValue(true);
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
  isEnabled.mockRestore();
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
    expect(capturedScope?.fingerprint).toEqual([
      "{{ default }}",
      "dependency",
      "test",
    ]);
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

describe("handled playback and transport policy", () => {
  test.each([
    "PLAY_ERROR",
    "WORKLET_LOAD_FAILED",
    "PLATFORM_CLIENT_RESOLUTION_FAILED",
    "STATIC_AUDIO_CLIENT_RESOLUTION_FAILED",
    "YOUTUBE_CLIENT_RESOLUTION_FAILED",
    "UNKNOWN",
  ])("reports unexpected %s failures", (errorCode) => {
    const cause = new Error("Dependency unavailable");
    expect(
      capturePlaybackError(cause, {
        errorCode,
        errorMessage: "Could not play",
        mode: "single",
      })
    ).toBe(EVENT_ID);
    expect(captureException).toHaveBeenCalledWith(cause);
    expect(capturedScope?.tags.error_code).toBe(errorCode);
  });

  test("reports distinct failures on one host without sending stream paths or station data", () => {
    const payload = {
      errorCode: "STREAM_FETCH_FAILED",
      errorMessage: "Stream failed",
      mode: "single" as const,
      radioName: "Private station name",
      streamUrl: "https://example.test/private-path?session=private#secret",
    };
    capturePlaybackError(new Error("Stream failed"), payload);
    expect(capturedScope?.fingerprint).toEqual([
      "{{ default }}",
      "radio-playback",
      "single",
      "STREAM_FETCH_FAILED",
    ]);
    expect(JSON.stringify(capturedScope)).not.toMatch(PRIVATE_DATA);
    capturePlaybackError(new Error("Fallback failed"), {
      ...payload,
      errorCode: "PLAYBACK_FALLBACK_FAILED",
    });
    expect(captureException).toHaveBeenCalledTimes(2);
  });

  test("keeps expected classifications through playback wrappers", () => {
    capturePlaybackError(
      new AppError({
        category: "validation",
        code: "UNSUPPORTED_URL",
        safeMessage: "Unsupported link",
      }),
      { errorCode: "PLAY_ERROR", errorMessage: "Could not play", mode: "dj" }
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  test("reports a server failure once and restores code/status/request id at the client", async () => {
    const result = await runServerFn({
      fallback: {
        category: "dependency",
        code: "PROVIDER_DOWN",
        safeMessage: "Could not resolve track",
      },
      operation: "resolveTrack",
      requestId: "req-test",
      run: () => Promise.reject(new Error("Provider unavailable")),
    });
    if (result.ok) {
      throw new Error("Expected failure result");
    }
    const transported = fromProblemError(
      JSON.parse(JSON.stringify(result.error))
    );
    expect(transported).toMatchObject({
      category: "dependency",
      code: "PROVIDER_DOWN",
      expected: false,
      status: 502,
      tags: { request_id: "req-test" },
    });
    capturePlaybackError(transported, {
      errorCode: "PLAY_ERROR",
      errorMessage: "Could not play",
      mode: "node",
    });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  test("only actual cancellation is quiet; recovery failures mentioning cancellation report", () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    expect(isAbortPlaybackError(abort)).toBe(true);
    capturePlaybackError(abort, {
      errorCode: "PLAY_ERROR",
      errorMessage: abort.message,
      mode: "single",
    });
    expect(captureException).not.toHaveBeenCalled();
    const recovery = new Error(
      "Recovery failed after the operation was aborted"
    );
    expect(isAbortPlaybackError(recovery, recovery.message)).toBe(false);
    capturePlaybackError(recovery, {
      errorCode: "PLAY_ERROR",
      errorMessage: recovery.message,
      mode: "single",
    });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  test("attaches caller-owned diagnostic context", () => {
    captureError(
      new AppError({
        category: "infrastructure",
        code: "WORKLET_FAILED",
        context: { backend: "worklet", phase: "initialization" },
        safeMessage: "Audio engine unavailable",
      }),
      { operation: "initializeAudio", surface: "ui" }
    );
    expect(capturedScope?.contexts.application).toEqual({
      backend: "worklet",
      phase: "initialization",
    });
  });

  test("noise filtering cannot combine separate linked exceptions", () => {
    const noise = {
      mechanism: { type: "auto.browser.browserapierrors.setTimeout" },
      value: "Error invoking post: Method not found",
    };
    expect(
      filterSentryEvent({ exception: { values: [noise] }, type: undefined }, {})
    ).toBeNull();
    const linked: Sentry.ErrorEvent = {
      exception: {
        values: [
          { value: noise.value },
          { mechanism: noise.mechanism, value: "Unexpected primary failure" },
        ],
      },
      type: undefined,
    };
    expect(filterSentryEvent(linked, {})).toBe(linked);
  });
});
