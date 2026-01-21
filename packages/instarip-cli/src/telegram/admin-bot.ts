import { autoRetry } from "@grammyjs/auto-retry";
import type { BotError } from "grammy";
import { Bot, GrammyError, HttpError, session } from "grammy";
import { createLogger } from "../infra/logger";
import {
  handlePostAddCommand,
  handlePostPreviewCommand,
} from "./admin/commands/post";
import { handlePreviewCommand } from "./admin/commands/preview";
import { handleSettingsInput } from "./admin/commands/settings";
import {
  handleTriggerInstagramCommand,
  handleTriggerTelegramCommand,
} from "./admin/commands/trigger";
// Import menu at the top level - it will be initialized when the module loads
import { mainMenu } from "./admin/menus";
import { adminAuthMiddleware, adminErrorMiddleware } from "./admin/middleware";
import type { AdminContext, SessionData } from "./admin/types";

/**
 * Handle bot errors
 */
function handleBotError(
  err: BotError<AdminContext>,
  logger: ReturnType<typeof createLogger>
): void {
  const ctx = err.ctx;
  logger.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    logger.error(
      `Telegram API error ${e.error_code ?? "unknown"}: ${e.description ?? e.message}`
    );
    if (e.error_code) {
      logger.debug(`Error code: ${e.error_code}`);
    }
    if (e.description) {
      logger.debug(`Error description: ${e.description}`);
    }
  } else if (e instanceof HttpError) {
    logger.error(`HTTP error: Could not contact Telegram: ${e.message}`);
  } else {
    logger.error(
      `Unknown error: ${e instanceof Error ? e.message : String(e)}`
    );
    if (e instanceof Error && e.stack) {
      logger.error(`Stack trace: ${e.stack}`);
    }
  }
}

/**
 * Create admin bot with proper typing
 */
function createAdminBot(): Bot<AdminContext> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN not set");
  }

  const bot = new Bot<AdminContext>(token);

  // Apply auto-retry plugin with exponential backoff for transient errors
  bot.api.config.use(
    autoRetry({
      maxRetryAttempts: 3,
      maxDelaySeconds: 60,
    })
  );

  // Configure global error handling
  const logger = createLogger(!!process.env.DEBUG);
  bot.catch((err: BotError<AdminContext>) => {
    handleBotError(err, logger);
  });

  return bot;
}

/**
 * Start the admin bot
 */
export async function startAdminBot(): Promise<void> {
  try {
    console.log("🔧 Creating bot instance...");
    const bot = createAdminBot();
    console.log("✅ Bot instance created");

    console.log("🔧 Registering middleware...");
    // SECURITY: Apply auth middleware FIRST to ensure ALL updates (messages, callbacks, etc.)
    // are authenticated before any other middleware or handlers can process them.
    // This middleware checks chat ID against admin_chat_id from database settings.
    bot.use(adminAuthMiddleware);
    console.log("✅ Auth middleware registered");

    // Install session middleware
    function initial(): SessionData {
      return {
        usersPage: {
          cursor: null,
          page: 1,
        },
        postsPage: {
          cursor: null,
          page: 1,
          filter: "all",
        },
        settingsSection: null,
        pendingInput: null,
      };
    }
    bot.use(
      session({ initial, getSessionKey: (ctx) => ctx.chat?.id.toString() })
    );
    console.log("✅ Session middleware registered");

    // Install menu middleware (must be before other handlers that use callbacks)
    // Menu is already initialized with all submenus registered when module loads
    // Verify menu is a valid Menu instance
    if (!mainMenu || typeof mainMenu !== "object") {
      throw new Error("mainMenu is not a valid menu object");
    }
    console.log(
      "Menu object type:",
      typeof mainMenu,
      "Constructor:",
      mainMenu.constructor?.name
    );

    // Apply error handling middleware BEFORE menu to catch menu errors properly
    bot.use(adminErrorMiddleware);
    console.log("✅ Error middleware registered");

    // Install menu after error middleware so errors are caught
    bot.use(mainMenu);
    console.log("✅ Menu middleware registered");

    // Post commands (for quick actions not in menu)
    bot.command("post", async (ctx) => {
      const args = ctx.message?.text?.split(" ").slice(1) ?? [];
      const subcommand = args[0];
      const url = args.slice(1).join(" ");

      if (subcommand === "add") {
        await handlePostAddCommand(ctx, url);
      } else if (subcommand === "preview") {
        await handlePostPreviewCommand(ctx, url);
      } else {
        await ctx.reply("Usage: /post add <url> or /post preview <url>", {
          parse_mode: "HTML",
        });
      }
    });

    // Preview command (for quick preview by post ID)
    bot.command("preview", async (ctx) => {
      const args = ctx.message?.text?.split(" ").slice(1) ?? [];
      const postId = args[0];
      await handlePreviewCommand(ctx, postId);
    });

    // Trigger commands (for manual job triggering)
    bot.command("trigger", async (ctx) => {
      const args = ctx.message?.text?.split(" ").slice(1) ?? [];
      const job = args[0];

      if (job === "instagram") {
        await handleTriggerInstagramCommand(ctx);
      } else if (job === "telegram") {
        await handleTriggerTelegramCommand(ctx);
      } else {
        await ctx.reply("Usage: /trigger instagram | /trigger telegram", {
          parse_mode: "HTML",
        });
      }
    });

    // Start command - show main menu (only required command)
    bot.command("start", async (ctx) => {
      await ctx.reply("👋 Welcome to Admin Bot!\n\nSelect an option:", {
        parse_mode: "HTML",
        reply_markup: mainMenu,
      });
    });

    // Handle text input for settings editing (must be after command handlers)
    // This will only process non-command text when waiting for input
    bot.on("message:text", async (ctx) => {
      const chatId = ctx.chat?.id?.toString();
      if (!chatId) {
        return;
      }

      const text = ctx.message.text;
      if (!text) {
        return;
      }

      // If it's a command, let command handlers process it (they're registered first)
      if (text.startsWith("/")) {
        return;
      }

      // Check if we're waiting for input (from session)
      if (ctx.session.pendingInput) {
        // Not a command, treat as input
        await handleSettingsInput(ctx, text);
        return;
      }

      // Otherwise, ignore (we only handle commands and settings input)
    });

    // Handle graceful shutdown
    process.once("SIGINT", () => {
      console.log("\n🛑 Shutting down admin bot...");
      bot.stop();
    });
    process.once("SIGTERM", () => {
      console.log("\n🛑 Shutting down admin bot...");
      bot.stop();
    });

    // Start bot (this will keep the process alive with long polling)
    console.log("✅ Admin bot started and listening for updates...");
    console.log("💡 Send /start to your bot in Telegram to begin");
    await bot.start();
  } catch (error) {
    console.error("💥 Failed to start admin bot:", error);
    if (error instanceof Error) {
      console.error(`   Error: ${error.message}`);
      if (error.stack) {
        console.error(`   Stack: ${error.stack}`);
      }
    }
    throw error;
  }
}
