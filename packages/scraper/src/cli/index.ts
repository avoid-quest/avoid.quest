import { startScheduler } from "../scheduler";

// PACKAGE_VERSION is injected at build time via --define flag
declare const PACKAGE_VERSION: string;

import {
  handleAdminCommand,
  handleScrapeCommand,
  handleSinglePostCommand,
  handleStartBothCommand,
  handleStartCommand,
  handleTelegramCommand,
} from "./commands";
import { showHelp } from "./help";
import { parseCommandLineArgs, validateCommand } from "./parser";
import type {
  AdminOptions,
  Command,
  CronOptions,
  SinglePostOptions,
  StartOptions,
} from "./types";

const POLL_INTERVAL_MS = 1000;
const SEPARATOR_LENGTH = 50;

export async function runCli(): Promise<number> {
  try {
    // Parse command line arguments
    const args = parseCommandLineArgs();

    // Validate command structure
    const validation = validateCommand(args);
    if (!validation.isValid) {
      console.error(validation.error);
      return 1;
    }

    // Handle help and version commands
    if (args.command === "help" || args.options.help) {
      // If help flag is used with a specific command, show command-specific help
      if (args.options.help && args.command !== "help") {
        showHelp(args.command as Command);
      } else {
        showHelp();
      }
      return 0;
    }

    if (args.command === "version") {
      // Version is injected at build time via --define PACKAGE_VERSION
      const version =
        typeof PACKAGE_VERSION !== "undefined" ? PACKAGE_VERSION : "unknown";
      console.log(`Scraper v${version}`);
      return 0;
    }

    // Execute commands
    switch (args.command) {
      case "start":
        await handleStartCommand(args.options as StartOptions);
        return 0;

      case "scrape":
        await handleScrapeCommand();
        return 0;

      case "telegram":
        await handleTelegramCommand();
        return 0;

      case "cron":
        await handleCronCommand(args.options as CronOptions, args.subcommand);
        return 0;

      case "start-both":
        await handleStartBothCommand();
        return 0;

      case "admin":
        await handleAdminCommand(args.options as AdminOptions);
        return 0;

      case "single-post":
        await handleSinglePostCommand(args.options as SinglePostOptions);
        return 0;

      case "user":
        handleUserCommand(args.subcommand, args.positionals);
        return 0;

      case "settings":
        handleSettingsCommand(
          args.subcommand || "help",
          args.positionals[0],
          args.positionals[1]
        );
        return 0;

      default:
        showHelp();
        return 0;
    }
  } catch (error) {
    console.error("💥 Unexpected error:", error);
    return 1;
  }
}

async function handleCronCommand(
  options: CronOptions,
  subcommand?: string
): Promise<void> {
  if (options.start || subcommand === "start") {
    console.log("🕐 Starting cron scheduler...");
    await startScheduler();

    // Keep the process alive
    console.log("\n💡 Press Ctrl+C to stop all cron jobs gracefully");
    console.log(
      "💡 Use 'bun run src/cli/index.ts cron status' to check job status"
    );

    // Keep the process running
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } else if (options.status || subcommand === "status") {
    console.log("⏰ Cron Job Status");
    console.log("=".repeat(SEPARATOR_LENGTH));
    console.log("Status: Not yet implemented");
    console.log("💡 Check scheduler status in future updates");
  } else {
    // Show cron help
    console.log("⏰ Cron Job Management");
    console.log("=".repeat(SEPARATOR_LENGTH));
    console.log("Available subcommands:");
    console.log("  start                    Start the cron scheduler");
    console.log(
      "  status                   Show job status and next run times"
    );
    console.log("");
    console.log("Examples:");
    console.log("  bun run src/cli/index.ts cron start");
    console.log("  bun run src/cli/index.ts cron status");
    console.log("");
    console.log("For detailed help, run: bun run src/cli/index.ts cron --help");
  }
}

function handleUserCommand(
  subcommand?: string,
  positionals: string[] = []
): void {
  switch (subcommand) {
    case "list":
      console.log("👥 User Management - List");
      console.log("=".repeat(SEPARATOR_LENGTH));
      console.log(
        "User management commands will be implemented in a future update."
      );
      break;
    case "add": {
      console.log("👥 User Management - Add");
      console.log("=".repeat(SEPARATOR_LENGTH));
      const username = positionals[0];
      if (!username) {
        console.error("❌ Username is required for 'add' command");
        console.log("Usage: bun run src/cli/index.ts user add <username>");
        process.exit(1);
      }
      console.log(`Would add user: ${username}`);
      console.log(
        "User management commands will be implemented in a future update."
      );
      break;
    }
    case "stats":
      console.log("👥 User Management - Stats");
      console.log("=".repeat(SEPARATOR_LENGTH));
      console.log("User statistics will be implemented in a future update.");
      break;
    default:
      console.log(`
👥 User Management Commands

USAGE:
  bun run src/cli/index.ts user <subcommand> [options]

SUBCOMMANDS:
  list     📋 List all users in database
  add      ➕ Add a new user to database
  stats    📊 Show user statistics

EXAMPLES:
  bun run src/cli/index.ts user list
  bun run src/cli/index.ts user add username
  bun run src/cli/index.ts user stats

💡 TIP: User management commands will be fully implemented in a future update.
      `);
      break;
  }
}

function handleSettingsCommand(
  subcommand: string,
  key?: string,
  value?: string
): void {
  switch (subcommand) {
    case "list":
      console.log("⚙️  Application Settings");
      console.log("=".repeat(SEPARATOR_LENGTH));
      console.log(
        "Settings management will be implemented in a future update."
      );
      break;

    case "get":
      if (!key) {
        console.log("❌ Please specify a setting key");
        console.log("Usage: bun run src/cli/index.ts settings get <key>");
        process.exit(1);
      }
      console.log(`⚙️  Settings Get: ${key}`);
      console.log(
        "Settings management will be implemented in a future update."
      );
      break;

    case "set":
      if (!key) {
        console.log("❌ Please specify both key and value");
        console.log(
          "Usage: bun run src/cli/index.ts settings set <key> <value>"
        );
        process.exit(1);
      }
      if (!value) {
        console.log("❌ Please specify both key and value");
        console.log(
          "Usage: bun run src/cli/index.ts settings set <key> <value>"
        );
        process.exit(1);
      }
      console.log(`⚙️  Settings Set: ${key} = ${value}`);
      console.log(
        "Settings management will be implemented in a future update."
      );
      break;

    case "reload":
      console.log("🔄 Reloading configuration...");
      console.log("Settings reload will be implemented in a future update.");
      break;

    case "init":
      console.log("🚀 Initializing default settings...");
      console.log(
        "Settings initialization will be implemented in a future update."
      );
      break;

    default:
      console.log("⚙️  Settings Management");
      console.log("=".repeat(SEPARATOR_LENGTH));
      console.log("Available subcommands:");
      console.log("  list                     List all settings");
      console.log("  get <key>                Get a specific setting value");
      console.log("  set <key> <value>        Set a setting value");
      console.log("  reload                   Reload cron configuration");
      console.log("  init                     Initialize default settings");
      console.log("");
      console.log("Examples:");
      console.log("  bun run src/cli/index.ts settings list");
      console.log("  bun run src/cli/index.ts settings get scrape_schedule");
      console.log(
        "  bun run src/cli/index.ts settings set scrape_schedule '0 */4 * * *'"
      );
      console.log("  bun run src/cli/index.ts settings reload");
      break;
  }
}

// Run when executed directly: `bun run ./packages/scraper/src/cli/index.ts <command>`
if (import.meta.main) {
  runCli().then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  });
}
