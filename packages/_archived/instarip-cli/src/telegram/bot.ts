import { createBotFromEnv } from "@avoid.quest/telegram/bot";
import type { Bot } from "grammy";
import { createLogger } from "../infra/logger";

/**
 * Create and configure a Telegram bot instance
 * @returns Bot instance or null if token is not available
 */
export function createBot(): Bot | null {
  const logger = createLogger(!!process.env.DEBUG);
  return createBotFromEnv(logger);
}
