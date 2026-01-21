import type { GrammyError } from "grammy";
import type { Logger } from "../logger/types";

/**
 * Logger interface for error operations
 * Uses the standard Logger interface for consistency across the package
 */
export type ErrorLogger = Logger;

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_TOO_MANY_REQUESTS = 429;

/**
 * Log Grammy error with context
 */
export function logGrammyError(
  logger: ErrorLogger,
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
 * Classified error types for handling
 */
export type TelegramErrorType =
  | "media_invalid"
  | "caption_too_long"
  | "media_group_invalid"
  | "file_too_big"
  | "bad_request"
  | "payload_too_large"
  | "rate_limited"
  | "bot_blocked"
  | "chat_not_found"
  | "forbidden"
  | "server_error"
  | "unknown";

/**
 * Classify a Telegram API error
 * Uses case-insensitive matching to handle variations in Telegram error format
 */
export function classifyError(error: GrammyError): TelegramErrorType {
  const errorCode = error.error_code;
  // Normalize description to lowercase for case-insensitive matching
  const description = (error.description || "").toLowerCase();

  switch (errorCode) {
    case HTTP_BAD_REQUEST:
      if (description.includes("media_invalid")) {
        return "media_invalid";
      }
      if (description.includes("caption_too_long")) {
        return "caption_too_long";
      }
      if (description.includes("media_group_invalid")) {
        return "media_group_invalid";
      }
      if (description.includes("file_too_big")) {
        return "file_too_big";
      }
      return "bad_request";

    case HTTP_PAYLOAD_TOO_LARGE:
      return "payload_too_large";

    case HTTP_TOO_MANY_REQUESTS:
      return "rate_limited";

    case HTTP_FORBIDDEN:
      if (description.includes("bot was blocked")) {
        return "bot_blocked";
      }
      if (description.includes("chat not found")) {
        return "chat_not_found";
      }
      return "forbidden";

    default:
      if (errorCode && errorCode >= 500 && errorCode < 600) {
        return "server_error";
      }
      return "unknown";
  }
}

/**
 * Handle specific Telegram API errors with recovery strategies
 */
export function handleTelegramApiError(
  error: GrammyError,
  logger: ErrorLogger,
  context: string
): void {
  logGrammyError(logger, error, context);

  const errorType = classifyError(error);

  switch (errorType) {
    case "media_invalid":
      logger.warn("Invalid media detected, trying fallback");
      break;
    case "caption_too_long":
      logger.warn("Caption too long, truncating");
      break;
    case "media_group_invalid":
      logger.warn("Media group invalid, will send individually");
      break;
    case "file_too_big":
      logger.warn("File too big, skipping this media");
      break;
    case "bad_request":
      logger.error("Bad Request (400) - Common causes:");
      logger.error("  - Invalid media URLs or file identifiers");
      logger.error("  - Media files too large");
      logger.error("  - Unsupported media formats");
      logger.error(
        "  - Videos without audio tracks (known Telegram API issue)"
      );
      break;
    case "payload_too_large":
      logger.error("Payload Too Large (413) - Media group exceeds size limits");
      break;
    case "rate_limited":
      logger.warn(
        "Rate limited, will retry later (auto-retry should handle this)"
      );
      break;
    case "bot_blocked":
      logger.error("Bot was blocked by user");
      break;
    case "chat_not_found":
      logger.error(
        "Chat not found, check TELEGRAM_CHAT_ID or group_chat_id setting"
      );
      break;
    case "forbidden":
      logger.error(`Forbidden error: ${error.description}`);
      break;
    case "server_error":
      logger.warn(`Server error (${error.error_code}), will retry`);
      break;
    default:
      logger.warn(
        `Unhandled Telegram error: ${error.error_code} - ${error.description}`
      );
  }
}
