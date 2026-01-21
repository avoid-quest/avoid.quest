import type { GrammyError } from "grammy";
import { HttpError } from "grammy";
import { classifyError } from "./classifier";

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_START = 500;
const HTTP_SERVER_ERROR_END = 600;

/**
 * Check if error is recoverable (should retry)
 */
export function isRecoverableError(error: unknown): boolean {
  if (isGrammyError(error)) {
    const errorCode = error.error_code;
    // Rate limits and server errors are recoverable
    return (
      errorCode === HTTP_TOO_MANY_REQUESTS ||
      (errorCode >= HTTP_SERVER_ERROR_START &&
        errorCode < HTTP_SERVER_ERROR_END)
    );
  }
  if (error instanceof HttpError) {
    // Network errors are recoverable
    return true;
  }
  return false;
}

/**
 * Type guard for GrammyError
 */
function isGrammyError(error: unknown): error is GrammyError {
  return (
    error !== null &&
    typeof error === "object" &&
    "error_code" in error &&
    "description" in error
  );
}

/**
 * Check if error is retryable based on error type
 */
export function isRetryableError(error: GrammyError): boolean {
  const errorType = classifyError(error);
  return errorType === "rate_limited" || errorType === "server_error";
}

/**
 * Check if error requires fallback strategy (e.g., send individually instead of group)
 */
export function requiresFallback(error: GrammyError): boolean {
  const errorType = classifyError(error);
  return (
    errorType === "media_invalid" ||
    errorType === "media_group_invalid" ||
    errorType === "file_too_big"
  );
}

/**
 * Check if error is a permanent failure (should not retry)
 */
export function isPermanentError(error: GrammyError): boolean {
  const errorType = classifyError(error);
  return (
    errorType === "bot_blocked" ||
    errorType === "chat_not_found" ||
    errorType === "forbidden"
  );
}

/**
 * Get retry delay in seconds for rate-limited errors
 * Returns undefined if error doesn't contain retry_after
 */
export function getRetryAfter(error: GrammyError): number | undefined {
  const params = error.parameters;
  if (params && typeof params === "object" && "retry_after" in params) {
    return params.retry_after as number;
  }
  return undefined;
}
