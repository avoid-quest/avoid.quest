type LogLevel = "info" | "warn" | "error";

type LogContext = {
  sessionId?: string;
  url?: string;
  endpoint?: string;
  [key: string]: unknown;
};

/**
 * Log security-related events
 */
export function logSecurityEvent(
  level: LogLevel,
  message: string,
  context?: LogContext
): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    level,
    message,
    timestamp,
    ...context,
  };

  // In production, you might want to send this to a logging service
  // For now, we'll use console
  switch (level) {
    case "error":
      console.error("[SECURITY]", JSON.stringify(logEntry));
      break;
    case "warn":
      console.warn("[SECURITY]", JSON.stringify(logEntry));
      break;
    case "info":
      console.info("[SECURITY]", JSON.stringify(logEntry));
      break;
    default:
      console.info("[SECURITY]", JSON.stringify(logEntry));
      break;
  }
}

/**
 * Log rate limit violations
 */
export function logRateLimitViolation(
  sessionId: string,
  endpoint: string
): void {
  logSecurityEvent("warn", "Rate limit exceeded", {
    endpoint,
    sessionId,
  });
}

/**
 * Log SSRF attempt
 */
export function logSSRFAttempt(
  sessionId: string,
  attemptedUrl: string,
  endpoint: string
): void {
  logSecurityEvent("warn", "SSRF attempt detected", {
    attemptedUrl,
    endpoint,
    sessionId,
  });
}

/**
 * Log authentication failure
 */
export function logAuthFailure(endpoint: string): void {
  logSecurityEvent("warn", "Authentication failure", {
    endpoint,
  });
}
