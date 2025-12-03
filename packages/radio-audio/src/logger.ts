export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogMetadata = {
  [key: string]: unknown;
};

export type Logger = {
  error(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  debug(message: string, metadata?: LogMetadata): void;
};

/**
 * Default logger implementation that falls back to console methods
 * but emits structured metadata as JSON
 */
class DefaultLogger implements Logger {
  error(message: string, metadata?: LogMetadata): void {
    const structured = this.formatStructured(message, "error", metadata);
    console.error(structured.message, structured.metadata);
  }

  warn(message: string, metadata?: LogMetadata): void {
    const structured = this.formatStructured(message, "warn", metadata);
    console.warn(structured.message, structured.metadata);
  }

  info(message: string, metadata?: LogMetadata): void {
    const structured = this.formatStructured(message, "info", metadata);
    console.info(structured.message, structured.metadata);
  }

  debug(message: string, metadata?: LogMetadata): void {
    const structured = this.formatStructured(message, "debug", metadata);
    console.debug(structured.message, structured.metadata);
  }

  private formatStructured(
    message: string,
    level: LogLevel,
    metadata?: LogMetadata
  ): { message: string; metadata: string } {
    const structuredMetadata = {
      level,
      timestamp: new Date().toISOString(),
      ...metadata,
    };
    return {
      message: `[${level.toUpperCase()}] ${message}`,
      metadata: JSON.stringify(structuredMetadata, null, 2),
    };
  }
}

/**
 * Default logger instance (safe fallback)
 */
const defaultLogger = new DefaultLogger();

/**
 * Get a logger instance. If no logger is provided, returns the default logger
 * that uses console methods with structured metadata.
 */
export function getLogger(customLogger?: Logger): Logger {
  return customLogger ?? defaultLogger;
}
