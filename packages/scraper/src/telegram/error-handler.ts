import { GrammyError, HttpError } from "grammy";
import type { createLogger } from "../infra/logger";

type Logger = ReturnType<typeof createLogger>;

/**
 * Log Grammy error with enhanced context
 */
export function logGrammyError(
  logger: Logger,
  error: GrammyError,
  context: string
): void {
  const errorCode = error.error_code ?? "unknown";
  const description = error.description ?? error.message;
  logger.error(`${context}: Telegram API error ${errorCode} - ${description}`);
  if (error.error_code) {
    logger.debug(`Error code: ${error.error_code}`);
  }
  if (error.description) {
    logger.debug(`Error description: ${error.description}`);
  }
}

/**
 * Handle specific Telegram API errors with recovery strategies
 */
export function handleTelegramApiError(
  error: GrammyError,
  logger: Logger,
  context: string
): void {
  const errorCode = error.error_code;
  const description = error.description || "";

  logGrammyError(logger, error, context);

  const HTTP_BAD_REQUEST = 400;
  const HTTP_PAYLOAD_TOO_LARGE = 413;
  const HTTP_TOO_MANY_REQUESTS = 429;
  const HTTP_FORBIDDEN = 403;

  switch (errorCode) {
    case HTTP_BAD_REQUEST:
      if (description.includes("MEDIA_INVALID")) {
        logger.warn("🔄 Invalid media detected, trying fallback");
      } else if (description.includes("CAPTION_TOO_LONG")) {
        logger.warn("🔄 Caption too long, truncating");
      } else if (description.includes("MEDIA_GROUP_INVALID")) {
        logger.warn("🔄 Media group invalid, will send individually");
      } else if (description.includes("FILE_TOO_BIG")) {
        logger.warn("🔄 File too big, skipping this media");
      } else {
        logger.error("Bad Request (400) - Common causes:");
        logger.error("  - Invalid media URLs or file identifiers");
        logger.error("  - Media files too large");
        logger.error("  - Unsupported media formats");
        logger.error(
          "  - Videos without audio tracks (known Telegram API issue)"
        );
      }
      break;

    case HTTP_PAYLOAD_TOO_LARGE:
      logger.error("Payload Too Large (413) - Media group exceeds size limits");
      break;

    case HTTP_TOO_MANY_REQUESTS:
      logger.warn(
        "🔄 Rate limited, will retry later (auto-retry should handle this)"
      );
      // Don't mark as sent if rate limited
      break;

    case HTTP_FORBIDDEN:
      if (description.includes("bot was blocked")) {
        logger.error("🔄 Bot was blocked by user");
      } else if (description.includes("chat not found")) {
        logger.error(
          "🔄 Chat not found, check TELEGRAM_CHAT_ID or group_chat_id setting"
        );
      }
      break;

    default:
      logger.warn(`🔄 Unhandled Telegram error: ${errorCode} - ${description}`);
  }
}

/**
 * Check if error is recoverable (should retry)
 */
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_START = 500;
const HTTP_SERVER_ERROR_END = 600;

export function isRecoverableError(error: unknown): boolean {
  if (error instanceof GrammyError) {
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
