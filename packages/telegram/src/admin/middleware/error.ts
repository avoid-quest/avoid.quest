import type { NextFunction } from "grammy";
import type { AdminContext, BaseSessionData } from "./types";

/**
 * Error handling middleware for admin commands
 * Logs errors and sends a user-friendly message to the admin
 */
export async function adminErrorMiddleware<S extends BaseSessionData>(
  ctx: AdminContext<S>,
  next: NextFunction
): Promise<void> {
  try {
    await next();
  } catch (error) {
    const logger = ctx.logger;
    logger.error(
      `Admin command error: ${error instanceof Error ? error.message : String(error)}`
    );
    if (error instanceof Error && error.stack) {
      logger.error(`Stack trace: ${error.stack}`);
    }

    try {
      await ctx.reply(
        `Error: ${error instanceof Error ? error.message : "Unknown error occurred"}`,
        { parse_mode: "HTML" }
      );
    } catch (replyError) {
      logger.error(
        `Failed to send error message: ${replyError instanceof Error ? replyError.message : String(replyError)}`
      );
    }
  }
}

/**
 * Create a custom error handler middleware
 */
export function createErrorMiddleware<S extends BaseSessionData>(options: {
  formatError?: (error: Error) => string;
  logStack?: boolean;
}) {
  const { formatError, logStack = true } = options;

  return async function errorMiddleware(
    ctx: AdminContext<S>,
    next: NextFunction
  ): Promise<void> {
    try {
      await next();
    } catch (error) {
      const logger = ctx.logger;
      const errorObj =
        error instanceof Error ? error : new Error(String(error));

      logger.error(`Admin command error: ${errorObj.message}`);
      if (logStack && errorObj.stack) {
        logger.error(`Stack trace: ${errorObj.stack}`);
      }

      const userMessage = formatError
        ? formatError(errorObj)
        : `Error: ${errorObj.message}`;

      try {
        await ctx.reply(userMessage, { parse_mode: "HTML" });
      } catch (replyError) {
        logger.error(
          `Failed to send error message: ${replyError instanceof Error ? replyError.message : String(replyError)}`
        );
      }
    }
  };
}
