import { Cron } from "croner";
import { scrapeOnce } from "../scraping/scraper";
import { createLogger } from "../infra/logger";
import { getEffectiveSettings } from "../settings";
import { runTelegramOnce } from "../telegram";

let scrapeCron: Cron | null = null;
let telegramCron: Cron | null = null;
let scrapeCronExpression: string | undefined = undefined;
let telegramCronExpression: string | undefined = undefined;

function formatNextRun(nextRun: Date | null): string {
  if (!nextRun) {
    return "Not scheduled";
  }
  return nextRun.toISOString();
}

function formatNextRunHuman(nextRun: Date | null): string {
  if (!nextRun) {
    return "Not scheduled";
  }
  const now = new Date();
  const diff = nextRun.getTime() - now.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `in ${days} day${days > 1 ? "s" : ""} (${nextRun.toLocaleString()})`;
  }
  if (hours > 0) {
    return `in ${hours} hour${hours > 1 ? "s" : ""} (${nextRun.toLocaleString()})`;
  }
  if (minutes > 0) {
    return `in ${minutes} minute${minutes > 1 ? "s" : ""} (${nextRun.toLocaleString()})`;
  }
  return `now (${nextRun.toLocaleString()})`;
}

export async function startScheduler(): Promise<void> {
  const s = await getEffectiveSettings();
  const logger = createLogger(
    !!(s.logging?.active || process.env.DEBUG),
    process.env.DEBUG ? "debug" : "info"
  );

  logger.debug("Loading settings for scheduler");
  logger.debug(
    `Scraper settings: active=${s.scraper.active}, cron=${s.scraper.cron_expression ?? "not set"}`
  );
  logger.debug(
    `Telegram settings: active=${s.telegram.active}, cron=${s.telegram.cron_expression ?? "not set"}`
  );

  // Handle scraper cron job
  if (s.scraper.active && s.scraper.cron_expression) {
    scrapeCron?.stop();
    scrapeCronExpression = s.scraper.cron_expression;
    try {
      scrapeCron = new Cron(scrapeCronExpression, async () => {
        const jobLogger = createLogger(
          !!(s.logging?.active || process.env.DEBUG),
          process.env.DEBUG ? "debug" : "info"
        );
        jobLogger.info("🔄 Scraper cron job started");
        try {
          await scrapeOnce();
          jobLogger.info("✅ Scraper cron job completed");
        } catch (error) {
          jobLogger.error(
            `❌ Scraper cron job failed: ${error instanceof Error ? error.message : String(error)}`
          );
          if (error instanceof Error && error.stack) {
            jobLogger.debug(`Stack trace: ${error.stack}`);
          }
        }
      });
      const nextRun = scrapeCron.next();
      logger.info(
        `✅ Scraper cron job created successfully. Next run: ${formatNextRunHuman(nextRun)}`
      );
      logger.debug(`Scraper next run (ISO): ${formatNextRun(nextRun)}`);
    } catch (error) {
      logger.error(
        `❌ Failed to create scraper cron job: ${error instanceof Error ? error.message : String(error)}`
      );
      scrapeCron = null;
      scrapeCronExpression = undefined;
    }
  } else {
    scrapeCron?.stop();
    scrapeCron = null;
    scrapeCronExpression = undefined;
    if (!s.scraper.active) {
      logger.debug("Scraper cron job not created: scraper is not active");
    } else if (!s.scraper.cron_expression) {
      logger.debug("Scraper cron job not created: cron_expression is not set");
    }
  }

  // Handle telegram cron job
  if (s.telegram.active && s.telegram.cron_expression) {
    telegramCron?.stop();
    telegramCronExpression = s.telegram.cron_expression;
    try {
      telegramCron = new Cron(telegramCronExpression, async () => {
        const jobLogger = createLogger(
          !!(s.logging?.active || process.env.DEBUG),
          process.env.DEBUG ? "debug" : "info"
        );
        jobLogger.info("📤 Telegram cron job started");
        try {
          await runTelegramOnce();
          jobLogger.info("✅ Telegram cron job completed");
        } catch (error) {
          jobLogger.error(
            `❌ Telegram cron job failed: ${error instanceof Error ? error.message : String(error)}`
          );
          if (error instanceof Error && error.stack) {
            jobLogger.debug(`Stack trace: ${error.stack}`);
          }
        }
      });
      const nextRun = telegramCron.next();
      logger.info(
        `✅ Telegram cron job created successfully. Next run: ${formatNextRunHuman(nextRun)}`
      );
      logger.debug(`Telegram next run (ISO): ${formatNextRun(nextRun)}`);
    } catch (error) {
      logger.error(
        `❌ Failed to create telegram cron job: ${error instanceof Error ? error.message : String(error)}`
      );
      telegramCron = null;
      telegramCronExpression = undefined;
    }
  } else {
    telegramCron?.stop();
    telegramCron = null;
    telegramCronExpression = undefined;
    if (!s.telegram.active) {
      logger.debug("Telegram cron job not created: telegram is not active");
    } else if (!s.telegram.cron_expression) {
      logger.debug("Telegram cron job not created: cron_expression is not set");
    }
  }

  if (!scrapeCron && !telegramCron) {
    logger.warn("⚠️  No cron jobs are scheduled. Check your settings.");
  }
}

export function stopScheduler(): void {
  scrapeCron?.stop();
  telegramCron?.stop();
  scrapeCron = null;
  telegramCron = null;
  scrapeCronExpression = undefined;
  telegramCronExpression = undefined;
}

export function getScraperNextRun(): Date | null {
  return scrapeCron?.next() ?? null;
}

export function getTelegramNextRun(): Date | null {
  return telegramCron?.next() ?? null;
}

export function getSchedulerStatus(): {
  scraper: { active: boolean; nextRun: Date | null; cronExpression: string | undefined };
  telegram: { active: boolean; nextRun: Date | null; cronExpression: string | undefined };
} {
  return {
    scraper: {
      active: scrapeCron !== null,
      nextRun: scrapeCron?.next() ?? null,
      cronExpression: scrapeCronExpression,
    },
    telegram: {
      active: telegramCron !== null,
      nextRun: telegramCron?.next() ?? null,
      cronExpression: telegramCronExpression,
    },
  };
}
