import { Cron } from "croner";
import { scrapeOnce } from "../scraping/scraper";
import { getEffectiveSettings } from "../settings";
import { runTelegramOnce } from "../telegram";

let scrapeCron: Cron | null = null;
let telegramCron: Cron | null = null;

export async function startScheduler(): Promise<void> {
  const s = await getEffectiveSettings();

  if (s.scraper.active && s.scraper.cron_expression) {
    scrapeCron?.stop();
    scrapeCron = new Cron(s.scraper.cron_expression, async () => {
      await scrapeOnce();
    });
  }

  if (s.telegram.active && s.telegram.cron_expression) {
    telegramCron?.stop();
    telegramCron = new Cron(s.telegram.cron_expression, async () => {
      await runTelegramOnce();
    });
  }
}

export function stopScheduler(): void {
  scrapeCron?.stop();
  telegramCron?.stop();
  scrapeCron = null;
  telegramCron = null;
}
