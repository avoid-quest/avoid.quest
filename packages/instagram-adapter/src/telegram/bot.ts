import { autoRetry } from "@grammyjs/auto-retry";
import type { BotError } from "grammy";
import { Bot, GrammyError, HttpError } from "grammy";
import { createLogger } from "../infra/logger";

/**
 * Create and configure a Telegram bot instance
 * @returns Bot instance or null if token is not available
 */
export function createBot(): Bot | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return null;
  }

  const bot = new Bot(token);

  // Apply auto-retry plugin with exponential backoff for transient errors
  bot.api.config.use(
    autoRetry({
      maxRetries: 3,
      maxDelaySeconds: 60,
      retryOnInternalServerErrors: true,
    })
  );

  // Configure global error handling
  const logger = createLogger(!!process.env.DEBUG);

  function handleGrammyError(error: GrammyError): void {
    logger.error(
      `Telegram API error ${error.error_code ?? "unknown"}: ${error.description ?? error.message}`
    );
    if (error.error_code) {
      logger.debug(`Error code: ${error.error_code}`);
    }
    if (error.description) {
      logger.debug(`Error description: ${error.description}`);
    }
  }

  function handleHttpError(error: HttpError): void {
    logger.error(`HTTP error: Could not contact Telegram: ${error.message}`);
  }

  function handleUnknownError(error: unknown): void {
    logger.error(
      `Unknown error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  bot.catch((err: BotError) => {
    const ctx = err.ctx;
    logger.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
      handleGrammyError(e);
    } else if (e instanceof HttpError) {
      handleHttpError(e);
    } else {
      handleUnknownError(e);
    }
  });

  return bot;
}
