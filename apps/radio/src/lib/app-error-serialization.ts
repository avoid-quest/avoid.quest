import {
  fail,
  fromProblemError,
  shouldReportToSentry,
  toAppError,
} from "@avoid.quest/error";
import { captureException, isEnabled } from "@sentry/core";
import { createSerializationAdapter } from "@tanstack/react-router";

// TanStack also serializes failures it catches internally, outside Sentry's
// middleware. Capture the original object so native dedupe keeps middleware
// captures to one event, and leave reporting available when no transport exists.
export const appErrorSerialization = createSerializationAdapter({
  fromSerializable: fromProblemError,
  key: "radio/AppError",
  test: (value): value is Error => value instanceof Error,
  toSerializable: (error) => {
    const appError = toAppError(error, {
      category: "unknown",
      code: "SERVER_FUNCTION_ERROR",
      safeMessage: "Something went wrong. Please try again.",
    });
    const reportingHandled =
      appError.reportingHandled ||
      (shouldReportToSentry(appError) &&
        isEnabled() &&
        !!captureException(error));
    return fail(appError, "", reportingHandled).error;
  },
});
