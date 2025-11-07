import { GrammyError } from "grammy";
import { api, getHttpClient } from "../convex/client";
import { createLogger } from "../infra/logger";
import { getEffectiveSettings } from "../settings";
import { DEFAULT_SEND_LIMIT } from "./types";
import { createBot } from "./bot";
import { sendPost } from "./post-sender";
import { logGrammyError } from "./error-handler";

/**
 * Run telegram sending once - fetch unsent posts and send them
 * This is the main entry point for the telegram functionality
 */
export async function runTelegramOnce(): Promise<void> {
  const settings = await getEffectiveSettings();
  const logger = createLogger(
    !!(settings.logging?.active || process.env.DEBUG)
  );

  if (!settings.telegram.active) {
    logger.debug("Telegram is not active, skipping");
    return;
  }

  const bot = createBot();
  if (!bot) {
    logger.warn("TELEGRAM_BOT_TOKEN not set, skipping telegram send");
    return;
  }

  const chatId =
    settings.telegram.group_chat_id || settings.telegram.admin_chat_id;
  if (!chatId) {
    logger.warn("No chat ID configured (group_chat_id or admin_chat_id), skipping telegram send");
    return;
  }

  const limit = settings.telegram.send_limit ?? DEFAULT_SEND_LIMIT;
  const unsent = await getHttpClient().query(api.posts.getUnsent, { limit });
  logger.info(`Sending ${unsent.length} unsent posts`);

  for (const post of unsent) {
    try {
      await sendPost(bot, chatId, post, logger);
      await getHttpClient().mutation(api.posts.markSent, {
        id: post._id,
        sentAt: Date.now(),
      });
      logger.debug(`Successfully sent and marked post ${post._id} as sent`);
    } catch (error) {
      // Log error but continue processing other posts
      if (error instanceof GrammyError) {
        logGrammyError(logger, error, `Failed to send post ${post._id}, skipping`);
      } else {
        logger.error(`Failed to send post ${post._id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      // Don't mark as sent if sending failed
      // Continue to next post
    }
  }

  logger.info(`Finished processing ${unsent.length} posts`);
}
