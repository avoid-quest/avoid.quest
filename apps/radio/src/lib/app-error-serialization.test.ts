import { expect, test } from "bun:test";
import {
  AppError,
  captureError,
  fail,
  fromProblemError,
  makeSentryOptions,
  runServerFn,
} from "@avoid.quest/error";
import { CloudflareClient } from "@sentry/cloudflare";
// biome-ignore lint/performance/noNamespaceImport: exercise the installed SDK with a local transport
import * as Sentry from "@sentry/core";
import { nodeStackLineParser } from "@sentry/core/server";
import { appErrorSerialization } from "./app-error-serialization";

test("serialization retains actual reporting ownership and safely reports framework-caught failures", async () => {
  const events: Sentry.Event[] = [];
  const options = makeSentryOptions({
    dsn: "http://key@localhost/42",
    environment: "test",
    release: "radio@test",
  });
  const failure = new AppError({
    category: "dependency",
    code: "PROVIDER_DOWN",
    safeMessage: "Could not resolve track",
  });
  const runFailure = () =>
    runServerFn({
      fallback: {
        category: "dependency",
        code: "PROVIDER_DOWN",
        safeMessage: "Could not resolve track",
      },
      operation: "resolveTrack",
      run: () => Promise.reject(failure),
    });
  try {
    Sentry.getCurrentScope().setClient(undefined);
    expect(fail(failure, "req-test").error.reportingHandled).toBe(false);
    expect(
      fromProblemError({
        code: "OLD_FAILURE",
        message: "Failure",
        requestId: "",
        status: 500,
      }).reportingHandled
    ).toBe(false);
    const disconnected = await runFailure();
    if (disconnected.ok) {
      throw new Error("Expected failure");
    }
    expect(disconnected.error.reportingHandled).toBe(false);
    const rawError = new Error("private upstream response");
    const disconnectedPayload = appErrorSerialization.toSerializable(rawError);
    expect(disconnectedPayload.reportingHandled).toBe(false);
    expect(disconnectedPayload.message).toBe(
      "Something went wrong. Please try again."
    );

    const client = new CloudflareClient({
      ...options,
      integrations: [],
      stackParser: Sentry.createStackParser(nodeStackLineParser()),
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
    Sentry.setCurrentClient(client);
    client.init();
    captureError(fromProblemError(disconnected.error), {
      operation: "client.fallback",
      surface: "ui",
    });
    const owned = await runFailure();
    if (owned.ok) {
      throw new Error("Expected failure");
    }
    expect(owned.error.reportingHandled).toBe(true);
    captureError(fromProblemError(owned.error), {
      operation: "client.owned",
      surface: "ui",
    });

    Sentry.captureException(rawError);
    expect(
      appErrorSerialization.toSerializable(rawError).reportingHandled
    ).toBe(true);
    const parsingError = new SyntaxError("synthetic malformed JSON");
    const parsingPayload = appErrorSerialization.toSerializable(parsingError);
    expect(parsingPayload.reportingHandled).toBe(true);
    captureError(appErrorSerialization.fromSerializable(parsingPayload), {
      operation: "client.framework",
      surface: "ui",
    });
    const serializationError = new Error(
      "synthetic response serialization failure"
    );
    expect(
      appErrorSerialization.toSerializable(serializationError).reportingHandled
    ).toBe(true);
    await Sentry.flush(2000);
    expect(events).toHaveLength(5);
    expect(
      events.filter((event) => event.tags?.operation === "client.owned")
    ).toHaveLength(0);
    expect(
      events.filter((event) =>
        event.exception?.values?.some(
          (value) => value.value === rawError.message
        )
      )
    ).toHaveLength(1);
    expect(
      events.filter((event) =>
        event.exception?.values?.some(
          (value) => value.value === parsingError.message
        )
      )
    ).toHaveLength(1);
    expect(
      events.filter((event) =>
        event.exception?.values?.some(
          (value) => value.value === serializationError.message
        )
      )
    ).toHaveLength(1);
  } finally {
    await Sentry.close();
    Sentry.getCurrentScope().setClient(undefined);
    Sentry.getIsolationScope().setClient(undefined);
  }
});
