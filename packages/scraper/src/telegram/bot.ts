import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, GrammyError, HttpError } from "grammy";
import type { BotError } from "grammy";
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
  bot.catch((err: BotError) => {
    const ctx = err.ctx;
    logger.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
      logger.error(`Telegram API error ${e.error_code ?? "unknown"}: ${e.description ?? e.message}`);
      if (e.error_code) {
        logger.debug(`Error code: ${e.error_code}`);
      }
      if (e.description) {
        logger.debug(`Error description: ${e.description}`);
      }
    } else if (e instanceof HttpError) {
      logger.error(`HTTP error: Could not contact Telegram: ${e.message}`);
    } else {
      logger.error(`Unknown error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  return bot;
}

