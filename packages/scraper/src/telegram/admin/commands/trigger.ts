import { scrapeOnce } from "../../../scraping/scraper";
import { runTelegramOnce } from "../../../telegram";
import type { AdminContext } from "../types";

export async function handleTriggerScraperCommand(
  ctx: AdminContext
): Promise<void> {
  await ctx.reply("⏳ Triggering scraper job...", { parse_mode: "HTML" });

  try {
    await scrapeOnce();
    await ctx.reply("✅ Scraper job completed successfully!", {
      parse_mode: "HTML",
    });
  } catch (error) {
    ctx.logger.error(
      `Error triggering scraper: ${error instanceof Error ? error.message : String(error)}`
    );
    await ctx.reply(
      `❌ Scraper job failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      { parse_mode: "HTML" }
    );
  }
}

export async function handleTriggerTelegramCommand(
  ctx: AdminContext
): Promise<void> {
  await ctx.reply("⏳ Triggering telegram job...", { parse_mode: "HTML" });

  try {
    await runTelegramOnce();
    await ctx.reply("✅ Telegram job completed successfully!", {
      parse_mode: "HTML",
    });
  } catch (error) {
    ctx.logger.error(
      `Error triggering telegram: ${error instanceof Error ? error.message : String(error)}`
    );
    await ctx.reply(
      `❌ Telegram job failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      { parse_mode: "HTML" }
    );
  }
}
