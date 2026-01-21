import type { GrammyError } from "grammy";
import { HttpError } from "grammy";
import { classifyError } from "./classifier";

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_START = 500;
const HTTP_SERVER_ERROR_END = 600;

/**
 * Patterns indicating permanent network errors that should not be retried
 * These typically indicate configuration issues or infrastructure problems
 */
const PERMANENT_NETWORK_ERROR_PATTERNS = [
  "enotfound", // DNS resolution failure
  "getaddrinfo", // DNS lookup failed
  "certificate", // TLS/SSL certificate issues
  "self signed", // Self-signed certificate
  "unable to verify", // Certificate verification failed
] as const;

/**
 * Check if a network error is transient (should retry) or permanent (should not retry)
 */
function isTransientNetworkError(error: HttpError): boolean {
  const message = error.message.toLowerCase();

  // Check if error matches any permanent error pattern
  for (const pattern of PERMANENT_NETWORK_ERROR_PATTERNS) {
    if (message.includes(pattern)) {
      return false; // Permanent error, don't retry
    }
  }

  // Assume other network errors are transient (timeouts, connection resets, etc.)
  return true;
}

/**
 * Check if error is recoverable (should retry)
 * Differentiates between transient network errors (retry) and permanent ones (don't retry)
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
    // Only transient network errors are recoverable
    return isTransientNetworkError(error);
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
 * Returns undefined if error doesn't contain a valid retry_after value
 */
export function getRetryAfter(error: GrammyError): number | undefined {
  const params = error.parameters;
  if (params && typeof params === "object" && "retry_after" in params) {
    const retryAfter = params.retry_after;
    // Validate retry_after is a positive number before returning
    if (typeof retryAfter === "number" && retryAfter > 0) {
      return retryAfter;
    }
  }
  return undefined;
}
