declare const PACKAGE_VERSION: string;

import {
  handleAdminCommand,
  handleFetchCommand,
  handleSinglePostCommand,
  handleStartBothCommand,
  handleStartCommand,
  handleTelegramCommand,
} from "./commands";
import { showHelp } from "./help";
import { parseCommandLineArgs, validateCommand } from "./parser";
import type { CronOptions, GlobalOptions, SinglePostOptions } from "./types";

const AT_PREFIX_REGEX = /^@/;

const version =
  typeof PACKAGE_VERSION !== "undefined" ? PACKAGE_VERSION : "dev";

type SchedulerJobStatus = {
  active: boolean;
  nextRun: Date | null;
  cronExpression?: string;
};

function printJobStatus(name: string, status: SchedulerJobStatus): void {
  console.log(`${name}:`);
  console.log(`  Active: ${status.active ? "✅" : "❌"}`);
  if (status.active && status.nextRun !== null) {
    console.log(`  Next run: ${status.nextRun.toLocaleString()}`);
    if (status.cronExpression) {
      console.log(`  Cron: ${status.cronExpression}`);
    }
  }
}

async function handleCronTrigger(job: string | undefined): Promise<void> {
  if (job === "instagram") {
    console.log("🔄 Triggering Instagram fetch...");
    const { fetchOnce } = await import("../adapter/adapter");
    await fetchOnce();
    console.log("✅ Instagram fetch completed");
    return;
  }
  if (job === "telegram") {
    console.log("📤 Triggering Telegram send...");
    const { runTelegramOnce } = await import("../telegram");
    await runTelegramOnce();
    console.log("✅ Telegram send completed");
    return;
  }
  console.error(`Unknown job: ${job}`);
  console.log("Available jobs: instagram, telegram");
  process.exit(1);
}

async function handleCronCommand(
  options: CronOptions,
  subcommand?: string
): Promise<void> {
  const { getSchedulerStatus, startScheduler } = await import("../scheduler");

  switch (subcommand) {
    case "status": {
      const status = getSchedulerStatus();
      console.log("\n📊 Scheduler Status\n");
      printJobStatus("Instagram", status.instagram);
      console.log("");
      printJobStatus("Telegram", status.telegram);
      break;
    }
    case "start": {
      console.log("🚀 Starting scheduler...");
      await startScheduler();
      console.log("✅ Scheduler started");
      const POLL_INTERVAL_MS = 1000;
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      break;
    }
    case "trigger": {
      await handleCronTrigger(options.trigger);
      break;
    }
    default:
      showHelp("cron");
  }
}

async function handleUserCommand(
  _options: GlobalOptions,
  positionals: string[]
): Promise<void> {
  const { api, getHttpClient } = await import("../convex/client");
  const subcommand = positionals[0];

  switch (subcommand) {
    case "list": {
      const users = await getHttpClient().query(api.users.getUsers, {});
      console.log(`\n👥 Users (${users.length}):\n`);
      for (const user of users) {
        const status = user.to_be_scraped ? "active" : "paused";
        console.log(`  @${user.username} [${status}]`);
      }
      break;
    }
    case "add": {
      const username = positionals[1];
      if (!username) {
        console.error("❌ Please provide a username");
        console.log("Usage: instarip user add <username>");
        process.exit(1);
      }
      await getHttpClient().mutation(api.users.upsertUser, {
        username: username.replace(AT_PREFIX_REGEX, ""),
        to_be_scraped: true,
      });
      console.log(`✅ Added user @${username}`);
      break;
    }
    case "toggle": {
      const username = positionals[1];
      if (!username) {
        console.error("❌ Please provide a username");
        console.log("Usage: instarip user toggle <username>");
        process.exit(1);
      }
      const user = await getHttpClient().query(api.users.getUserByUsername, {
        username: username.replace(AT_PREFIX_REGEX, ""),
      });
      if (!user) {
        console.error(`❌ User @${username} not found`);
        process.exit(1);
      }
      await getHttpClient().mutation(api.users.upsertUser, {
        id: user._id,
        username: user.username,
        to_be_scraped: !user.to_be_scraped,
      });
      const newStatus = user.to_be_scraped ? "paused" : "active";
      console.log(`✅ User @${username} is now ${newStatus}`);
      break;
    }
    default:
      console.log(`
👥 User Command

Usage: instarip user <subcommand> [options]

Subcommands:
  list              List all users
  add <username>    Add a new user to scrape
  toggle <username> Toggle scraping for a user
`);
  }
}

async function handleSettingsCommand(_options: GlobalOptions): Promise<void> {
  const { getEffectiveSettings } = await import("../settings");
  const settings = await getEffectiveSettings();

  console.log("\n⚙️  Current Settings\n");

  console.log("Instagram:");
  console.log(`  Active: ${settings.instagram.active ? "✅" : "❌"}`);
  console.log(`  Cron: ${settings.instagram.cron_expression ?? "not set"}`);
  console.log(
    `  Posts per user: ${settings.instagram.post_per_user ?? "default"}`
  );
  console.log(`  Limit: ${settings.instagram.limit ?? "default"}`);

  console.log("\nTelegram:");
  console.log(`  Active: ${settings.telegram.active ? "✅" : "❌"}`);
  console.log(`  Cron: ${settings.telegram.cron_expression ?? "not set"}`);
  console.log(`  Send limit: ${settings.telegram.send_limit}`);
  console.log(`  Send report: ${settings.telegram.send_report ? "✅" : "❌"}`);

  console.log("\nLogging:");
  console.log(`  Active: ${settings.logging.active ? "✅" : "❌"}`);
  console.log(`  Log level: ${settings.logging.log_level ?? "not set"}`);
}

async function main(): Promise<void> {
  const args = parseCommandLineArgs();

  if (
    args.command === "version" ||
    (args.options as GlobalOptions).version === true
  ) {
    console.log(`instarip v${version}`);
    return;
  }

  if (args.options.help) {
    showHelp(args.command as Parameters<typeof showHelp>[0]);
    return;
  }

  if (args.command === "help") {
    showHelp();
    return;
  }

  const validation = validateCommand(args);
  if (!validation.isValid) {
    console.error(validation.error);
    process.exit(1);
  }

  switch (args.command) {
    case "start":
      await handleStartCommand(args.options);
      return;
    case "fetch":
      await handleFetchCommand();
      return;
    case "telegram":
      await handleTelegramCommand();
      return;
    case "start-both":
      await handleStartBothCommand();
      return;
    case "single-post":
      await handleSinglePostCommand(args.options as SinglePostOptions);
      return;
    case "admin":
      await handleAdminCommand(args.options);
      return;
    case "cron":
      await handleCronCommand(args.options as CronOptions, args.subcommand);
      return;
    case "user":
      await handleUserCommand(args.options as GlobalOptions, args.positionals);
      return;
    case "settings":
      await handleSettingsCommand(args.options as GlobalOptions);
      return;
    default:
      console.error(`Unknown command: ${args.command}`);
      showHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
