import { api, getHttpClient } from "../../../convex/client";
import { getEffectiveSettings } from "../../../settings";
import { clearAdminChatIdCache } from "../middleware";
import type { AdminContext } from "../types";
import { escapeHtml } from "../utils";

async function validateAndParseInput(
  key: string,
  text: string,
  ctx: AdminContext
): Promise<string | number | undefined | null> {
  if (key === "send_limit" || key === "limit") {
    const num = Number.parseInt(text.trim(), 10);
    if (Number.isNaN(num) || num < 1) {
      await ctx.reply("❌ Invalid number. Must be >= 1", {
        parse_mode: "HTML",
      });
      return null;
    }
    return num;
  }
  if (key === "cron_expression") {
    const cron = text.trim();
    if (cron.length === 0) {
      await ctx.reply("❌ Cron expression cannot be empty", {
        parse_mode: "HTML",
      });
      return null;
    }
    return cron;
  }
  if (key === "log_level") {
    const level = text.trim().toLowerCase();
    if (!["debug", "info", "warn", "error"].includes(level)) {
      await ctx.reply(
        "❌ Invalid log level. Must be: debug, info, warn, or error",
        { parse_mode: "HTML" }
      );
      return null;
    }
    return level;
  }
  return text.trim();
}

type UpdateSettingsOptions = {
  section: string;
  key: string;
  value: string | number;
  settingsId: string | undefined;
  settings: Awaited<ReturnType<typeof getEffectiveSettings>>;
};

async function updateSettingsBySection(
  options: UpdateSettingsOptions
): Promise<void> {
  const { section, key, value, settingsId, settings } = options;
  if (section === "telegram") {
    await getHttpClient().mutation(api.settings.upsertSettings, {
      id: settingsId,
      telegram: {
        ...settings.telegram,
        [key]: value,
      },
    });
    clearAdminChatIdCache();
  } else if (section === "scraper") {
    await getHttpClient().mutation(api.settings.upsertSettings, {
      id: settingsId,
      scraper: {
        ...settings.scraper,
        [key]: value,
      },
    });
  } else {
    await getHttpClient().mutation(api.settings.upsertSettings, {
      id: settingsId,
      logging: {
        ...settings.logging,
        [key]: value,
      },
    });
  }
}

export async function handleSettingsInput(
  ctx: AdminContext,
  text: string
): Promise<void> {
  const pending = ctx.session.pendingInput;
  if (!pending) {
    return; // Not waiting for input
  }

  const { section, key } = pending;

  // Clear pending input
  ctx.session.pendingInput = null;
  const settings = await getEffectiveSettings();
  const settingsDoc = await getHttpClient().query(api.settings.getSettings, {});
  const settingsId = settingsDoc?._id;

  try {
    const value = await validateAndParseInput(key, text, ctx);
    if (value === null) {
      return; // Validation failed, error already sent
    }

    await updateSettingsBySection({
      section,
      key,
      value,
      settingsId,
      settings,
    });

    await ctx.reply(
      `✅ ${key} updated to: <code>${escapeHtml(String(value))}</code>`,
      { parse_mode: "HTML" }
    );
  } catch (error) {
    ctx.logger.error(
      `Error updating settings: ${error instanceof Error ? error.message : String(error)}`
    );
    await ctx.reply(
      `❌ Error updating settings: ${error instanceof Error ? error.message : "Unknown error"}`,
      { parse_mode: "HTML" }
    );
  }
}
