import type { NextFunction } from "grammy";
import type { AdminLogger, AuthProvider } from "../adapters/types";
import type { AdminContext, BaseSessionData } from "./types";

/**
 * Cache configuration for auth middleware
 */
export type AuthCacheConfig = {
  /** Cache TTL in milliseconds */
  ttlMs: number;
};

const DEFAULT_CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Options for creating auth middleware
 */
export type CreateAuthMiddlewareOptions = {
  provider: AuthProvider;
  logger: AdminLogger;
  cache?: AuthCacheConfig;
};

/**
 * Create admin authentication middleware
 * Silently ignores all messages from non-admin chats
 */
export function createAuthMiddleware<S extends BaseSessionData>(options: {
  provider: AuthProvider;
  logger: AdminLogger;
  cache?: AuthCacheConfig;
}) {
  const { provider, logger, cache = { ttlMs: DEFAULT_CACHE_TTL_MS } } = options;

  // Internal cache state
  let cachedAdminChatId: string | null = null;
  let cacheTimestamp = 0;

  async function getAdminChatId(): Promise<string | null> {
    const currentTime = Date.now();
    if (
      cachedAdminChatId !== null &&
      currentTime - cacheTimestamp < cache.ttlMs
    ) {
      return cachedAdminChatId;
    }

    try {
      cachedAdminChatId = await provider.getAuthorizedChatId();
      cacheTimestamp = currentTime;
      return cachedAdminChatId;
    } catch (error) {
      logger.error(
        `Failed to load admin_chat_id: ${error instanceof Error ? error.message : String(error)}`
      );
      return cachedAdminChatId; // Return cached value on error
    }
  }

  /**
   * Clear the admin chat ID cache
   */
  function clearCache(): void {
    cachedAdminChatId = null;
    cacheTimestamp = 0;
  }

  /**
   * The middleware function
   */
  async function middleware(
    ctx: AdminContext<S>,
    next: NextFunction
  ): Promise<void> {
    const adminChatId = await getAdminChatId();

    if (!adminChatId) {
      // No admin chat ID configured - reject for security
      return;
    }

    // Get chat ID from various update types
    const chatId =
      ctx.chat?.id?.toString() ||
      ctx.callbackQuery?.message?.chat?.id?.toString() ||
      ctx.update.callback_query?.message?.chat?.id?.toString() ||
      ctx.update.message?.chat?.id?.toString();

    // Strict comparison
    if (!chatId || chatId !== adminChatId) {
      // Not admin chat - silently ignore
      return;
    }

    // Verified admin - add properties to context
    ctx.adminChatId = adminChatId;
    ctx.logger = logger;

    await next();
  }

  return {
    middleware,
    clearCache,
  };
}
