import { now } from "@workspace/backend/convex/lib/dateUtils";
import { Cron } from "croner";
import { createLogger } from "../infra/logger";
import { scrapeOnce } from "../scraping/scraper";
import { getEffectiveSettings } from "../settings";
import { runTelegramOnce } from "../telegram";

let scrapeCron: Cron | null = null;
let telegramCron: Cron | null = null;
let scrapeCronExpression: string | undefined;
let telegramCronExpression: string | undefined;

function formatNextRun(nextRun: Date | null): string {
  if (!nextRun) {
    return "Not scheduled";
  }
  return nextRun.toISOString();
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;

function formatNextRunHuman(nextRun: Date | null): string {
  if (!nextRun) {
    return "Not scheduled";
  }
  const currentTime = now();
  const diff = nextRun.getTime() - currentTime;
  const minutes = Math.floor(diff / MS_PER_MINUTE);
  const hours = Math.floor(minutes / SECONDS_PER_MINUTE);
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

function getLogLevel(): "debug" | "info" {
  return process.env.DEBUG ? "debug" : "info";
}

function createJobLogger(
  isLoggingEnabled: boolean
): ReturnType<typeof createLogger> {
  return createLogger(isLoggingEnabled, getLogLevel());
}

function logErrorWithStack(
  logger: ReturnType<typeof createLogger>,
  error: unknown,
  prefix: string
): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`${prefix}: ${message}`);
  if (error instanceof Error) {
    const stack = error.stack;
    if (stack) {
      logger.debug(`Stack trace: ${stack}`);
    }
  }
}

function createScraperCronJob(
  cronExpression: string,
  isLoggingEnabled: boolean,
  logger: ReturnType<typeof createLogger>
): void {
  scrapeCron?.stop();
  scrapeCronExpression = cronExpression;
  try {
    scrapeCron = new Cron(cronExpression, async () => {
      const jobLogger = createJobLogger(isLoggingEnabled);
      jobLogger.info("🔄 Scraper cron job started");
      try {
        await scrapeOnce();
        jobLogger.info("✅ Scraper cron job completed");
      } catch (error) {
        logErrorWithStack(jobLogger, error, "❌ Scraper cron job failed");
      }
    });
    const nextRun = scrapeCron.nextRun();
    logger.info(
      `✅ Scraper cron job created successfully. Next run: ${formatNextRunHuman(nextRun)}`
    );
    logger.debug(`Scraper next run (ISO): ${formatNextRun(nextRun)}`);
  } catch (error) {
    logErrorWithStack(logger, error, "❌ Failed to create scraper cron job");
    scrapeCron = null;
    scrapeCronExpression = undefined;
  }
}

function stopScraperCron(
  logger: ReturnType<typeof createLogger>,
  settings: { active: boolean; cron_expression?: string }
): void {
  scrapeCron?.stop();
  scrapeCron = null;
  scrapeCronExpression = undefined;
  if (!settings.active) {
    logger.debug("Scraper cron job not created: scraper is not active");
  } else if (!settings.cron_expression) {
    logger.debug("Scraper cron job not created: cron_expression is not set");
  }
}

function createTelegramCronJob(
  cronExpression: string,
  isLoggingEnabled: boolean,
  logger: ReturnType<typeof createLogger>
): void {
  telegramCron?.stop();
  telegramCronExpression = cronExpression;
  try {
    telegramCron = new Cron(cronExpression, async () => {
      const jobLogger = createJobLogger(isLoggingEnabled);
      jobLogger.info("📤 Telegram cron job started");
      try {
        await runTelegramOnce();
        jobLogger.info("✅ Telegram cron job completed");
      } catch (error) {
        logErrorWithStack(jobLogger, error, "❌ Telegram cron job failed");
      }
    });
    const nextRun = telegramCron.nextRun();
    logger.info(
      `✅ Telegram cron job created successfully. Next run: ${formatNextRunHuman(nextRun)}`
    );
    logger.debug(`Telegram next run (ISO): ${formatNextRun(nextRun)}`);
  } catch (error) {
    logErrorWithStack(logger, error, "❌ Failed to create telegram cron job");
    telegramCron = null;
    telegramCronExpression = undefined;
  }
}

function stopTelegramCron(
  logger: ReturnType<typeof createLogger>,
  settings: { active: boolean; cron_expression?: string }
): void {
  telegramCron?.stop();
  telegramCron = null;
  telegramCronExpression = undefined;
  if (!settings.active) {
    logger.debug("Telegram cron job not created: telegram is not active");
  } else if (!settings.cron_expression) {
    logger.debug("Telegram cron job not created: cron_expression is not set");
  }
}

export async function startScheduler(): Promise<void> {
  const s = await getEffectiveSettings();
  const isLoggingEnabled = !!(s.logging.active || process.env.DEBUG);
  const logger = createLogger(isLoggingEnabled, getLogLevel());

  logger.debug("Loading settings for scheduler");
  logger.debug(
    `Scraper settings: active=${s.scraper.active}, cron=${s.scraper.cron_expression ?? "not set"}`
  );
  logger.debug(
    `Telegram settings: active=${s.telegram.active}, cron=${s.telegram.cron_expression ?? "not set"}`
  );

  if (s.scraper.active && s.scraper.cron_expression) {
    createScraperCronJob(s.scraper.cron_expression, isLoggingEnabled, logger);
  } else {
    stopScraperCron(logger, s.scraper);
  }

  if (s.telegram.active && s.telegram.cron_expression) {
    createTelegramCronJob(s.telegram.cron_expression, isLoggingEnabled, logger);
  } else {
    stopTelegramCron(logger, s.telegram);
  }

  if (!(scrapeCron || telegramCron)) {
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
  return scrapeCron?.nextRun() ?? null;
}

export function getTelegramNextRun(): Date | null {
  return telegramCron?.nextRun() ?? null;
}

export function getSchedulerStatus(): {
  scraper: {
    active: boolean;
    nextRun: Date | null;
    cronExpression: string | undefined;
  };
  telegram: {
    active: boolean;
    nextRun: Date | null;
    cronExpression: string | undefined;
  };
} {
  return {
    scraper: {
      active: scrapeCron !== null,
      nextRun: scrapeCron?.nextRun() ?? null,
      cronExpression: scrapeCronExpression,
    },
    telegram: {
      active: telegramCron !== null,
      nextRun: telegramCron?.nextRun() ?? null,
      cronExpression: telegramCronExpression,
    },
  };
}
