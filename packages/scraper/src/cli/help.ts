import type { Command } from "./types";

/**
 * Display help information for the application
 */
export function showHelp(command?: Command): void {
  if (command === "scrape") {
    showScrapeHelp();
  } else if (command === "telegram") {
    showTelegramHelp();
  } else if (command === "cron") {
    showCronHelp();
  } else if (command === "start") {
    showStartHelp();
  } else if (command === "start-both") {
    showStartBothHelp();
  } else if (command === "admin") {
    showAdminHelp();
  } else if (command === "single-post") {
    showSinglePostHelp();
  } else {
    showMainHelp();
  }
}

function showStartHelp(): void {
  console.log(`
🚀 Start Command - FULL SYSTEM

Starts the complete scraper system with cron scheduler.

USAGE:
  bun run src/cli/index.ts start [options]

OPTIONS:
  -v, --verbose    Enable verbose output
  -h, --help       Show this help message

WHAT IT STARTS:
  🕐 Cron Scheduler:
    • Automated scraping jobs (based on settings)
    • Automated telegram jobs (based on settings)

EXAMPLES:
  bun run src/cli/index.ts start
  bun run src/cli/index.ts start --verbose

💡 TIP: This is the main command for production deployment!
`);
}

function showMainHelp(): void {
  console.log(`
🚀 Scraper - Instagram Scraper & Telegram Bot

USAGE:
  bun run src/cli/index.ts <command> [options]

MAIN COMMANDS:
  start       🚀 Start FULL SYSTEM (cron scheduler) - RECOMMENDED for production

DEVELOPMENT/TESTING COMMANDS:
  scrape      🔍 Run scraping job IMMEDIATELY (manual execution)
  telegram    📤 Run telegram job IMMEDIATELY (manual execution)
  start-both  🚀 Run BOTH jobs IMMEDIATELY in sequence (manual execution)
  single-post 📱 Scrape a single Instagram post by URL
  cron        ⏰ Manage SCHEDULED jobs (automated execution)
  user        👥 Manage users in database
  settings    ⚙️  Manage application settings
  help        Show this help message
  version     Show version information

EXAMPLES:
  # Start full system
  bun run src/cli/index.ts start

  # Manual scraping
  bun run src/cli/index.ts scrape
  bun run src/cli/index.ts telegram

  # Single post
  bun run src/cli/index.ts single-post --url https://www.instagram.com/p/ABC123/

GLOBAL OPTIONS:
  -v, --verbose    Enable verbose output
  -h, --help       Show help information
  --version        Show version information

For more information about a specific command, run:
  bun run src/cli/index.ts <command> --help
`);
}

function showScrapeHelp(): void {
  console.log(`
🔍 Scrape Command - IMMEDIATE EXECUTION

Scrapes Instagram profiles and saves posts to the database RIGHT NOW.

USAGE:
  bun run src/cli/index.ts scrape [options]

OPTIONS:
  -v, --verbose              Enable verbose output
  -h, --help                 Show this help message

EXAMPLES:
  bun run src/cli/index.ts scrape
  bun run src/cli/index.ts scrape --verbose

💡 TIP: Use this when you want to run scraping immediately!
`);
}

function showTelegramHelp(): void {
  console.log(`
📤 Telegram Command - IMMEDIATE EXECUTION

Sends unsent posts to Telegram RIGHT NOW.

USAGE:
  bun run src/cli/index.ts telegram [options]

OPTIONS:
  -v, --verbose    Enable verbose output
  -h, --help       Show this help message

EXAMPLES:
  bun run src/cli/index.ts telegram
  bun run src/cli/index.ts telegram --verbose

💡 TIP: Use this when you want to run telegram immediately!
`);
}

function showCronHelp(): void {
  console.log(`
⏰ Cron Command - SCHEDULED AUTOMATION

Manage automated jobs that run at scheduled times.

USAGE:
  bun run src/cli/index.ts cron <subcommand> [options]

SUBCOMMANDS:
  start                    🚀 Start the scheduler (jobs run automatically)
  status                   📊 Show job status and next run times

EXAMPLES:
  bun run src/cli/index.ts cron start
  bun run src/cli/index.ts cron status

💡 TIP: Use 'scrape', 'telegram', or 'start-both' commands for immediate execution!
`);
}

function showStartBothHelp(): void {
  console.log(`
🚀 Start Both Command - IMMEDIATE EXECUTION

Runs both scrape and telegram jobs RIGHT NOW in sequence.

USAGE:
  bun run src/cli/index.ts start-both [options]

OPTIONS:
  -v, --verbose    Enable verbose output
  -h, --help       Show this help message

EXAMPLES:
  bun run src/cli/index.ts start-both
  bun run src/cli/index.ts start-both --verbose

💡 TIP: Use this when you want to run both jobs immediately!
`);
}

function showAdminHelp(): void {
  console.log(`
🤖 Admin Command

Starts an interactive Telegram admin bot for managing the scraper.

USAGE:
  bun run src/cli/index.ts admin [options]

OPTIONS:
  -v, --verbose    Enable verbose output
  -h, --help       Show this help message

NOTE: Admin bot functionality will be implemented in a future update.
`);
}

function showSinglePostHelp(): void {
  console.log(`
📱 Single Post Command - SCRAPE INDIVIDUAL POSTS

Scrapes a single Instagram post by URL and optionally saves it to the database.

USAGE:
  bun run src/cli/index.ts single-post --url <instagram_post_url> [options]

OPTIONS:
  --url <url>              Instagram post URL (required)
  --save                   Save post to database (default: true)
  --no-save                Don't save to database, just display data
  -v, --verbose            Enable verbose output
  -h, --help               Show this help message

EXAMPLES:
  # Scrape and save to database
  bun run src/cli/index.ts single-post --url https://www.instagram.com/p/ABC123/
  
  # Scrape but don't save to database
  bun run src/cli/index.ts single-post --url https://www.instagram.com/p/ABC123/ --no-save

URL FORMAT:
  ✅ Valid: https://www.instagram.com/p/SHORTCODE/
  ❌ Invalid: https://instagram.com/p/SHORTCODE (missing trailing slash)
  ❌ Invalid: https://www.instagram.com/reel/SHORTCODE/ (reels not supported)

FEATURES:
  🔍 Extracts post metadata using Instagram's oEmbed API
  📸 Captures media items (images, videos, thumbnails)
  💾 Optionally saves to database with full media relationships

💡 TIP: Use this for testing or when you need to scrape specific posts!
`);
}
