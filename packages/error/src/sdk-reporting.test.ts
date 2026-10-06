import { expect, test } from "bun:test";
// biome-ignore lint/performance/noNamespaceImport: exercise the installed SDK and native integrations
import * as Sentry from "@sentry/react";
import { AppError, capturePlaybackError, makeSentryOptions } from "./index";

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
