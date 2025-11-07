import { Menu } from "@grammyjs/menu";
import { api, getHttpClient } from "../../../convex/client";
import { getEffectiveSettings } from "../../../settings";
import { clearAdminChatIdCache } from "../middleware";
import type { AdminContext } from "../types";
import { formatSectionSettings, navigateToMainMenu } from "../utils";

/**
 * Settings menu - main settings navigation
 */
export const settingsMenu = new Menu<AdminContext>("settings-menu")
  .text("📱 Telegram", async (ctx) => {
    const settings = await getEffectiveSettings();
    const text = formatSectionSettings("telegram", settings);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: settingsTelegramMenu,
    });
  })
  .row()
  .text("🔍 Scraper", async (ctx) => {
    const settings = await getEffectiveSettings();
    const text = formatSectionSettings("scraper", settings);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: settingsScraperMenu,
    });
  })
  .row()
  .text("📝 Logging", async (ctx) => {
    const settings = await getEffectiveSettings();
    const text = formatSectionSettings("logging", settings);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: settingsLoggingMenu,
    });
  })
  .row()
  .text("🏠 Home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await navigateToMainMenu(ctx);
  });

/**
 * Telegram settings menu
 */
export const settingsTelegramMenu = new Menu<AdminContext>(
  "settings-telegram-menu"
)
  .text(
    async () => {
      const settings = await getEffectiveSettings();
      return `Active: ${settings.telegram.active ? "✅" : "❌"}`;
    },
    async (ctx) => {
      const settings = await getEffectiveSettings();
      const settingsDoc = await getHttpClient().query(
        api.settings.getSettings,
        {}
      );
      const settingsId = settingsDoc?._id;

      const newValue = !settings.telegram.active;
      await getHttpClient().mutation(api.settings.upsertSettings, {
        id: settingsId,
        telegram: {
          ...settings.telegram,
          active: newValue,
        },
      });

      clearAdminChatIdCache();
      await ctx.answerCallbackQuery({
        text: `Active set to ${newValue ? "true" : "false"}`,
      });
      await ctx.menu.update();
    }
  )
  .row()
  .text("Edit Send Limit", async (ctx) => {
    ctx.session.pendingInput = {
      type: "edit",
      section: "telegram",
      key: "send_limit",
    };
    await ctx.reply("Enter new send limit (number):", { parse_mode: "HTML" });
  })
  .row()
  .text("Edit Cron", async (ctx) => {
    ctx.session.pendingInput = {
      type: "edit",
      section: "telegram",
      key: "cron_expression",
    };
    await ctx.reply(
      'Enter new cron expression (e.g., "0 */6 * * *" for every 6 hours):',
      { parse_mode: "HTML" }
    );
  })
  .row()
  .text(
    async () => {
      const settings = await getEffectiveSettings();
      return `Send Report: ${settings.telegram.send_report ? "✅" : "❌"}`;
    },
    async (ctx) => {
      const settings = await getEffectiveSettings();
      const settingsDoc = await getHttpClient().query(
        api.settings.getSettings,
        {}
      );
      const settingsId = settingsDoc?._id;

      const newValue = !settings.telegram.send_report;
      await getHttpClient().mutation(api.settings.upsertSettings, {
        id: settingsId,
        telegram: {
          ...settings.telegram,
          send_report: newValue,
        },
      });

      await ctx.answerCallbackQuery({
        text: `Send Report set to ${newValue ? "true" : "false"}`,
      });
      await ctx.menu.update();
    }
  )
  .row()
  .text("🏠 Home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await navigateToMainMenu(ctx);
  })
  .back("⬅️ Back");

/**
 * Scraper settings menu
 */
export const settingsScraperMenu = new Menu<AdminContext>(
  "settings-scraper-menu"
)
  .text(
    async () => {
      const settings = await getEffectiveSettings();
      return `Active: ${settings.scraper.active ? "✅" : "❌"}`;
    },
    async (ctx) => {
      const settings = await getEffectiveSettings();
      const settingsDoc = await getHttpClient().query(
        api.settings.getSettings,
        {}
      );
      const settingsId = settingsDoc?._id;

      const newValue = !settings.scraper.active;
      await getHttpClient().mutation(api.settings.upsertSettings, {
        id: settingsId,
        scraper: {
          ...settings.scraper,
          active: newValue,
        },
      });

      await ctx.answerCallbackQuery({
        text: `Active set to ${newValue ? "true" : "false"}`,
      });
      await ctx.menu.update();
    }
  )
  .row()
  .text("Edit Limit", async (ctx) => {
    ctx.session.pendingInput = {
      type: "edit",
      section: "scraper",
      key: "limit",
    };
    await ctx.reply("Enter new limit (number):", { parse_mode: "HTML" });
  })
  .row()
  .text("Edit Cron", async (ctx) => {
    ctx.session.pendingInput = {
      type: "edit",
      section: "scraper",
      key: "cron_expression",
    };
    await ctx.reply(
      'Enter new cron expression (e.g., "0 */6 * * *" for every 6 hours):',
      { parse_mode: "HTML" }
    );
  })
  .row()
  .text("🏠 Home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await navigateToMainMenu(ctx);
  })
  .back("⬅️ Back");

/**
 * Logging settings menu
 */
export const settingsLoggingMenu = new Menu<AdminContext>(
  "settings-logging-menu"
)
  .text(
    async () => {
      const settings = await getEffectiveSettings();
      return `Active: ${settings.logging.active ? "✅" : "❌"}`;
    },
    async (ctx) => {
      const settings = await getEffectiveSettings();
      const settingsDoc = await getHttpClient().query(
        api.settings.getSettings,
        {}
      );
      const settingsId = settingsDoc?._id;

      const newValue = !settings.logging.active;
      await getHttpClient().mutation(api.settings.upsertSettings, {
        id: settingsId,
        logging: {
          ...settings.logging,
          active: newValue,
        },
      });

      await ctx.answerCallbackQuery({
        text: `Active set to ${newValue ? "true" : "false"}`,
      });
      await ctx.menu.update();
    }
  )
  .row()
  .text("Edit Log Level", async (ctx) => {
    ctx.session.pendingInput = {
      type: "edit",
      section: "logging",
      key: "log_level",
    };
    await ctx.reply("Enter log level (debug, info, warn, error):", {
      parse_mode: "HTML",
    });
  })
  .row()
  .text("🏠 Home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await navigateToMainMenu(ctx);
  })
  .back("⬅️ Back");
