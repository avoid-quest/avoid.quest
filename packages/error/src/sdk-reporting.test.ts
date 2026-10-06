import { expect, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: exercise the installed SDK and native integrations
import * as Sentry from "@sentry/react";
import {
  AppError,
  captureError,
  capturePlaybackError,
  makeSentryOptions,
} from "./index";

test("the real SDK reports terminal failures and framework exceptions, with native dedupe and expected-outcome filtering", async () => {
  const events: Sentry.Event[] = [];
  const envelopeTypes: string[] = [];
  Sentry.init({
    ...makeSentryOptions({
      dsn: "http://key@localhost/42",
      environment: "test",
      release: "radio@test",
    }),
    transport: () => ({
      flush: () => Promise.resolve(true),
      send: (envelope) => {
        for (const [header, event] of envelope[1]) {
          envelopeTypes.push(header.type);
          if (header.type === "event") {
            events.push(event as Sentry.Event);
          }
        }
        return Promise.resolve({ statusCode: 200 });
      },
    }),
  });
  try {
    const payload = {
      errorCode: "WORKLET_LOAD_FAILED",
      errorMessage: "Audio engine failed",
      mode: "single" as const,
      streamUrl: "https://example.test/private-path?session=private",
    };
    Sentry.addBreadcrumb({ category: "console", message: payload.streamUrl });
    Sentry.addBreadcrumb({ data: { url: payload.streamUrl }, type: "http" });
    const cause = new Error("Audio engine unavailable");
    capturePlaybackError(cause, payload);
    capturePlaybackError(cause, payload);
    capturePlaybackError(new Error("Fallback failed"), {
      ...payload,
      errorCode: "PLAYBACK_FALLBACK_FAILED",
    });
    Sentry.withScope((scope) => {
      scope.addEventProcessor((event) => ({
        ...event,
        request: { url: "https://radio.test/#data=private-backup" },
      }));
      Sentry.captureException(new Error("Framework failed"), {
        mechanism: { handled: false, type: "test.framework" },
      });
    });
    Sentry.captureException(
      new AppError({
        category: "validation",
        code: "INVALID_INPUT",
        safeMessage: "Invalid input",
      })
    );
    Sentry.captureException(new DOMException("Cancelled", "AbortError"));
    Sentry.logger.info("private diagnostic log");
    Sentry.metrics.count("private-diagnostic-metric");
    await Sentry.flush(2000);
    expect(events).toHaveLength(3);
    expect(envelopeTypes).not.toContain("log");
    expect(envelopeTypes).not.toContain("trace_metric");
    expect(events.map((event) => event.tags?.error_code)).toEqual([
      "WORKLET_LOAD_FAILED",
      "PLAYBACK_FALLBACK_FAILED",
      undefined,
    ]);
    expect(events[0]?.fingerprint?.[0]).toBe("{{ default }}");
    expect(events[2]?.exception?.values?.[0]?.mechanism?.handled).toBe(false);
    expect(JSON.stringify(events)).not.toContain("private-path");
    expect(JSON.stringify(events)).not.toContain("session=private");
    expect(JSON.stringify(events)).not.toContain("private-backup");
    expect(events.every((event) => event.user?.ip_address === undefined)).toBe(
      true
    );
    expect(events[1]?.breadcrumbs?.length).toBeGreaterThan(0);
  } finally {
    await Sentry.close();
    Sentry.getCurrentScope().clearBreadcrumbs();
    Sentry.getCurrentScope().setClient(undefined);
  }
});

test("outer classification controls cause capture while retaining cause stacks and native dedupe", async () => {
  const events: Sentry.Event[] = [];
  Sentry.init({
    ...makeSentryOptions({
      dsn: "http://key@localhost/42",
      environment: "test",
      release: "radio@test",
    }),
    transport: () => ({
      flush: () => Promise.resolve(true),
      send: (envelope) => {
        for (const [header, event] of envelope[1]) {
          if (header.type === "event") {
            events.push(event as Sentry.Event);
          }
        }
        return Promise.resolve({ statusCode: 200 });
      },
    }),
  });
  try {
    function providerFailure(): Error {
      const error = new Error("Original provider failure");
      error.stack =
        "Error: Original provider failure\n    at providerFailure (https://radio.example/provider.js:17:3)";
      return error;
    }
    const cause = new AppError({
      category: "validation",
      cause: providerFailure(),
      code: "EXPECTED_INNER",
      safeMessage: "Invalid inner value",
    });
    const critical = () =>
      new AppError({
        category: "infrastructure",
        cause,
        code: "CRITICAL_OUTER",
        safeMessage: "Infrastructure failed",
      });
    captureError(critical(), { operation: "critical.wrapper", surface: "ui" });
    captureError(critical(), { operation: "critical.wrapper", surface: "ui" });
    captureError(
      new AppError({
        category: "infrastructure",
        cause: new DOMException("Cancelled", "AbortError"),
        code: "CRITICAL_ABORT_CAUSE",
        safeMessage: "Critical recovery failed",
      }),
      { operation: "critical.abort", surface: "ui" }
    );
    captureError(
      new AppError({
        category: "validation",
        cause: new Error("Unexpected inner value"),
        code: "EXPECTED_OUTER",
        safeMessage: "Invalid outer value",
      }),
      { operation: "expected.wrapper", surface: "ui" }
    );
    await Sentry.flush(2000);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      level: "fatal",
      tags: {
        error_category: "infrastructure",
        error_code: "CRITICAL_OUTER",
        error_severity: "critical",
      },
    });
    const exceptions = events[0]?.exception?.values ?? [];
    expect(exceptions.map((value) => value.value)).toEqual([
      "Original provider failure",
      "Invalid inner value",
    ]);
    expect(
      exceptions[0]?.stacktrace?.frames?.some(
        (frame) => frame.function === "providerFailure"
      )
    ).toBe(true);
    expect(events[1]?.tags?.error_code).toBe("CRITICAL_ABORT_CAUSE");
  } finally {
    await Sentry.close();
    Sentry.getCurrentScope().clearBreadcrumbs();
    Sentry.getCurrentScope().setClient(undefined);
  }
});
