import type { BotError, Context } from "grammy";
import { Bot, GrammyError, HttpError } from "grammy";
import type { ErrorLogger } from "../errors/classifier";
import { applyAutoRetry } from "./plugins";

/**
 * Bot factory options
 */
export type CreateBotOptions = {
  token: string;
  logger: ErrorLogger;
  autoRetry?:
    | {
        maxRetries?: number;
        maxDelaySeconds?: number;
        retryOnInternalServerErrors?: boolean;
      }
    | false;
};

function handleGrammyError(error: GrammyError, logger: ErrorLogger): void {
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

function handleHttpError(error: HttpError, logger: ErrorLogger): void {
  logger.error(`HTTP error: Could not contact Telegram: ${error.message}`);
}

function handleUnknownError(error: unknown, logger: ErrorLogger): void {
  logger.error(
    `Unknown error: ${error instanceof Error ? error.message : String(error)}`
  );
}

/**
 * Create and configure a Telegram bot instance with default plugins
 */
export function createBot<C extends Context = Context>(
  options: CreateBotOptions
): Bot<C> {
  const { token, logger, autoRetry: autoRetryConfig = {} } = options;

  const bot = new Bot<C>(token);

  // Apply auto-retry unless explicitly disabled
  if (autoRetryConfig !== false) {
    applyAutoRetry(bot.api, autoRetryConfig);
  }

  // Configure global error handling
  bot.catch((err: BotError<C>) => {
    logger.error(`Error while handling update ${err.ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
      handleGrammyError(e, logger);
    } else if (e instanceof HttpError) {
      handleHttpError(e, logger);
    } else {
      handleUnknownError(e, logger);
    }
  });

  return bot;
}

/**
 * Create bot from environment variable
 * Returns null if TELEGRAM_BOT_TOKEN is not set
 */
export function createBotFromEnv(logger: ErrorLogger): Bot | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return null;
  }
  return createBot({ token, logger });
}
