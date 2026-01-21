/** biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: just complex */

import { now } from "@workspace/backend/convex/lib/dateUtils";
import { fetchAndSaveSinglePost, fetchOnce } from "../adapter/adapter";
import { InstagramAdapter } from "../adapter/instagram";
import { createLogger } from "../infra/logger";
import { TokenBucketLimiter } from "../infra/rate-limiter";
import { getSchedulerStatus, startScheduler } from "../scheduler";
import { getEffectiveSettings } from "../settings";
import { runTelegramOnce } from "../telegram";
import type { AdminOptions, SinglePostOptions, StartOptions } from "./types";

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const CLEAN_UP_DELAY_MS = 500;

/**
 * Handle start command - start scheduler
 */
export async function handleStartCommand(options: StartOptions): Promise<void> {
  console.log("🚀 Starting Instagram Adapter - Full System");

  if (options.verbose) {
    console.log("📊 Configuration:");
    console.log("  Mode: Full system (cron scheduler)");
    console.log("  Cron: Automated fetching and telegram jobs");
  }

  try {
    // Start cron scheduler
    console.log("🕐 Starting cron scheduler...");
    await startScheduler();

    // Get scheduler status for display
    const status = getSchedulerStatus();
    const settings = await getEffectiveSettings();
    const logger = createLogger(
      !!(settings.logging?.active || process.env.DEBUG),
      process.env.DEBUG ? "debug" : "info"
    );

    // Start admin bot in background
    let adminBotRunning = false;
    try {
      const { startAdminBot } = await import("../telegram/admin-bot");
      // Start admin bot but don't await (runs in background)
      startAdminBot().catch((error) => {
        logger.warn(
          `Admin bot failed to start: ${error instanceof Error ? error.message : String(error)}`
        );
        logger.debug(
          "Admin bot is optional and can be started separately with 'admin' command"
        );
      });
      adminBotRunning = true;
    } catch {
      // Admin bot is optional, just log a warning
      logger.debug(
        "Admin bot not available (TELEGRAM_BOT_TOKEN may not be set)"
      );
    }

    console.log("\n✅ Instagram Adapter is now running!");
    console.log("📋 Services running:");
    console.log("  • Cron scheduler (automated jobs)");
    if (adminBotRunning) {
      console.log("  • Admin bot (Telegram)");
    }

    // Display "Next Runs" section
    console.log("\n⏰ Next Runs:");
    if (status.instagram.active && status.instagram.nextRun) {
      const nextRun = status.instagram.nextRun;
      const currentTime = now();
      const diff = nextRun.getTime() - currentTime;
      const minutes = Math.floor(diff / MS_PER_MINUTE);
      const hours = Math.floor(minutes / SECONDS_PER_MINUTE);
      const days = Math.floor(hours / 24);

      let timeStr: string;
      if (days > 0) {
        timeStr = `in ${days} day${days > 1 ? "s" : ""}`;
      } else if (hours > 0) {
        timeStr = `in ${hours} hour${hours > 1 ? "s" : ""}`;
      } else if (minutes > 0) {
        timeStr = `in ${minutes} minute${minutes > 1 ? "s" : ""}`;
      } else {
        timeStr = "now";
      }
      console.log(`  📸 Instagram: ${timeStr} (${nextRun.toLocaleString()})`);
      if (status.instagram.cronExpression) {
        logger.debug(`    Cron expression: ${status.instagram.cronExpression}`);
      }
    } else {
      console.log("  📸 Instagram: Not scheduled");
      if (!settings.instagram.active) {
        logger.debug("    Reason: Instagram adapter is not active in settings");
      } else if (!settings.instagram.cron_expression) {
        logger.debug("    Reason: Cron expression is not set");
      }
    }

    if (status.telegram.active && status.telegram.nextRun) {
      const nextRun = status.telegram.nextRun;
      const currentTime = now();
      const diff = nextRun.getTime() - currentTime;
      const minutes = Math.floor(diff / MS_PER_MINUTE);
      const hours = Math.floor(minutes / SECONDS_PER_MINUTE);
      const days = Math.floor(hours / 24);

      let timeStr: string;
      if (days > 0) {
        timeStr = `in ${days} day${days > 1 ? "s" : ""}`;
      } else if (hours > 0) {
        timeStr = `in ${hours} hour${hours > 1 ? "s" : ""}`;
      } else if (minutes > 0) {
        timeStr = `in ${minutes} minute${minutes > 1 ? "s" : ""}`;
      } else {
        timeStr = "now";
      }
      console.log(`  📤 Telegram: ${timeStr} (${nextRun.toLocaleString()})`);
      if (status.telegram.cronExpression) {
        logger.debug(`    Cron expression: ${status.telegram.cronExpression}`);
      }
    } else {
      console.log("  📤 Telegram: Not scheduled");
      if (!settings.telegram.active) {
        logger.debug("    Reason: Telegram is not active in settings");
      } else if (!settings.telegram.cron_expression) {
        logger.debug("    Reason: Cron expression is not set");
      }
    }

    console.log("\n🛑 Press Ctrl+C to stop all services");

    // Set up graceful shutdown handlers
    let shutdownRequested = false;
    const shutdown = async (signal: string) => {
      if (shutdownRequested) {
        // Force exit if shutdown already requested
        console.log(`\n⚠️  Force stopping after ${signal}...`);
        process.exit(1);
      }
      shutdownRequested = true;
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

      try {
        // Stop scheduler (stops all cron jobs)
        const { stopScheduler } = await import("../scheduler");
        stopScheduler();
        console.log("✅ Scheduler stopped");
      } catch (error) {
        console.error(
          `⚠️  Error stopping scheduler: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Give a moment for cleanup, then exit
      setTimeout(() => {
        console.log("👋 Goodbye!");
        process.exit(0);
      }, CLEAN_UP_DELAY_MS);
    };

    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));

    const POLL_INTERVAL_MS = 1000;
    // Keep the process alive, but check for shutdown flag
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (shutdownRequested) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } catch (error) {
    console.error("💥 Failed to start Instagram Adapter:", error);
    process.exit(1);
  }
}

/**
 * Handle fetch command
 */
export async function handleFetchCommand(): Promise<void> {
  console.log("🚀 Starting Instagram adapter");
  try {
    await fetchOnce();
    console.log("✅ Fetching completed!");
  } catch (error) {
    console.error("💥 Fatal error during fetching:", error);
    process.exit(1);
  }
}

/**
 * Handle telegram command
 */
export async function handleTelegramCommand(): Promise<void> {
  console.log("📤 Sending unsent posts to Telegram");
  try {
    await runTelegramOnce();
    console.log("✅ Telegram job completed successfully!");
  } catch (error) {
    console.error("💥 Fatal error sending to Telegram:", error);
    process.exit(1);
  }
}

/**
 * Handle start-both command
 */
export async function handleStartBothCommand(): Promise<void> {
  console.log("🚀 Starting both fetch and telegram jobs");

  try {
    // First, run the fetch job
    console.log("\n🔍 Starting fetch job...");
    await fetchOnce();
    console.log("✅ Fetch completed!");

    // Then, run the telegram job
    console.log("\n📤 Starting telegram job...");
    await runTelegramOnce();
    console.log("✅ Telegram job completed successfully!");

    console.log("\n🎉 Both jobs completed successfully!");
  } catch (error) {
    console.error("💥 Fatal error during start-both operation:", error);
    process.exit(1);
  }
}

/**
 * Handle single-post command
 */
export async function handleSinglePostCommand(
  options: SinglePostOptions
): Promise<void> {
  console.log("📱 Starting single post fetcher");

  if (!options.url) {
    console.log("❌ Please provide an Instagram post URL");
    console.log(
      "Usage: bun run src/cli/index.ts single-post --url <instagram_post_url>"
    );
    console.log(
      "Example: bun run src/cli/index.ts single-post --url https://www.instagram.com/p/ABC123/"
    );
    process.exit(1);
  }

  if (options.verbose) {
    console.log("📊 Configuration:");
    console.log(`  Post URL: ${options.url}`);
    console.log(`  Save to database: ${options.save !== false}`);
  }

  try {
    if (options.save !== false) {
      // Fetch and save to database
      console.log("⏳ Fetching post and saving to database...");
      const result = await fetchAndSaveSinglePost(options.url);

      if (result.success) {
        console.log("✅ Successfully fetched and saved post to database!");
        if (result.postId) {
          console.log(`📊 Database Post ID: ${result.postId}`);
        }
      } else {
        console.log("❌ Failed to fetch and save post:");
        console.log(`   Error: ${result.error}`);
        process.exit(1);
      }
    } else {
      // Just fetch without saving
      console.log("⏳ Fetching post (not saving to database)...");
      const settings = await getEffectiveSettings();
      const logger = createLogger(
        !!(settings.logging?.active || process.env.DEBUG),
        process.env.DEBUG ? "debug" : "info"
      );
      const DEFAULT_BURST = 3;
      const DEFAULT_RPS = 0.5;
      const limiter = new TokenBucketLimiter(DEFAULT_BURST, DEFAULT_RPS);
      const adapter = new InstagramAdapter(
        {
          minDelayMs: 2000,
          maxDelayMs: 5000,
          timeoutMs: 30_000,
          postProcessingDelayMs: 2000,
          postProcessingMaxDelayMs: 5000,
        },
        { limiter, logger }
      );

      const result = await adapter.getSinglePost(options.url);

      if (result.success && result.post) {
        console.log("✅ Successfully fetched post!");
        console.log("📊 Post Data:");
        console.log(`   ID: ${result.post.id}`);
        console.log(`   Shortcode: ${result.post.shortcode}`);
        console.log(`   URL: ${result.post.url}`);
        console.log(`   Media Type: ${result.post.media_type}`);
        console.log(`   Is Video: ${result.post.is_video}`);
        const MAX_CAPTION_PREVIEW_LENGTH = 100;
        const captionPreview =
          result.post.caption.length > MAX_CAPTION_PREVIEW_LENGTH
            ? `${result.post.caption.substring(0, MAX_CAPTION_PREVIEW_LENGTH)}...`
            : result.post.caption;
        console.log(`   Caption: ${captionPreview}`);
        console.log(`   Display URL: ${result.post.display_url}`);
        console.log(`   Media Items: ${result.post.media_items.length}`);
        if (result.scraped_at) {
          console.log(`   Fetched At: ${result.scraped_at}`);
        }

        if (result.post.media_items.length > 0) {
          console.log("\n📸 Media Items:");
          result.post.media_items.forEach((item, index) => {
            console.log(`   ${index + 1}. ${item.type} - ${item.url}`);
            if (item.width && item.height) {
              console.log(`      Dimensions: ${item.width}x${item.height}`);
            }
          });
        }
      } else {
        console.log("❌ Failed to fetch post:");
        console.log(`   Error: ${result.error}`);
        if (result.code) {
          console.log(`   Code: ${result.code}`);
        }
        if (result.statusCode) {
          console.log(`   Status Code: ${result.statusCode}`);
        }
        process.exit(1);
      }
    }
  } catch (error) {
    console.error("💥 Fatal error during single post fetching:", error);
    process.exit(1);
  }
}

/**
 * Handle admin command - start admin bot
 */
export async function handleAdminCommand(options: AdminOptions): Promise<void> {
  console.log("🤖 Starting Admin Bot");

  if (options.verbose) {
    console.log("📊 Configuration:");
    console.log("  Mode: Admin bot (Telegram)");
  }

  try {
    const { startAdminBot } = await import("../telegram/admin-bot");
    await startAdminBot();

    console.log("\n✅ Admin bot is now running!");
    console.log("🛑 Press Ctrl+C to stop");

    // Keep the process alive
    const POLL_INTERVAL_MS = 1000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } catch (error) {
    console.error("💥 Failed to start Admin Bot:", error);
    process.exit(1);
  }
}
