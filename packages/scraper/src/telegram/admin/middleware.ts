import { now } from "@workspace/backend/convex/lib/dateUtils";
import type { NextFunction } from "grammy";
import { api, getHttpClient } from "../../convex/client";
import { createLogger } from "../../infra/logger";
import type { AdminContext } from "./types";

// Cache admin_chat_id to avoid repeated queries
let cachedAdminChatId: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute cache

/**
 * Get admin chat ID from settings, with caching
 */
async function getAdminChatId(): Promise<string | null> {
  const currentTime = now();
  if (
    cachedAdminChatId !== null &&
    currentTime - cacheTimestamp < CACHE_TTL_MS
  ) {
    return cachedAdminChatId;
  }

  try {
    const settings = await getHttpClient().query(api.settings.getSettings, {});
    cachedAdminChatId = settings?.telegram?.admin_chat_id ?? null;
    cacheTimestamp = currentTime;
    return cachedAdminChatId;
  } catch (error) {
    const logger = createLogger(!!process.env.DEBUG);
    logger.error(
      `Failed to load admin_chat_id: ${error instanceof Error ? error.message : String(error)}`
    );
    return cachedAdminChatId; // Return cached value on error
  }
}

/**
 * Clear admin chat ID cache (call after settings update)
 */
export function clearAdminChatIdCache(): void {
  cachedAdminChatId = null;
  cacheTimestamp = 0;
}

/**
 * Admin authentication middleware
 * Silently ignores all messages from non-admin chats
 * Adds admin properties to context
 *
 * SECURITY: This middleware MUST be applied first to ensure all updates
 * (messages, callback queries, etc.) are authenticated before processing.
 */
export async function adminAuthMiddleware(
  ctx: AdminContext,
  next: NextFunction
): Promise<void> {
  const adminChatId = await getAdminChatId();

  if (!adminChatId) {
    // No admin chat ID configured - reject all requests for security
    // This prevents the bot from accepting commands if admin_chat_id is not set
    return;
  }

  // Get chat ID from context (works for both messages and callback queries)
  // Grammy normalizes ctx.chat for all update types, but we check multiple sources
  // to be absolutely sure we're getting the correct chat ID
  const chatId =
    ctx.chat?.id?.toString() ||
    ctx.callbackQuery?.message?.chat?.id?.toString() ||
    ctx.update.callback_query?.message?.chat?.id?.toString() ||
    ctx.update.message?.chat?.id?.toString();

  // Strict comparison: chat ID must exactly match admin_chat_id from database
  if (!chatId || chatId !== adminChatId) {
    // Not admin chat - silently ignore (no response to prevent information leakage)
    return;
  }

  // Verified admin - add admin properties to context
  ctx.adminChatId = adminChatId;
  ctx.logger = createLogger(!!process.env.DEBUG);

  // Continue to next middleware/handler
  await next();
}

/**
 * Error handling middleware for admin commands
 */
export async function adminErrorMiddleware(
  ctx: AdminContext,
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

    // Send user-friendly error message to admin
    try {
      await ctx.reply(
        `❌ Error: ${error instanceof Error ? error.message : "Unknown error occurred"}`,
        { parse_mode: "HTML" }
      );
    } catch (replyError) {
      logger.error(
        `Failed to send error message: ${replyError instanceof Error ? replyError.message : String(replyError)}`
      );
    }
  }
}
