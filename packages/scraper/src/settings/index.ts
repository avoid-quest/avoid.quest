import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import { api, getHttpClient } from "../convex/client";

export type SettingsDoc = Doc<"settings">;

export async function loadSettings(): Promise<SettingsDoc | null> {
  return await getHttpClient().query(api.settings.getSettings, {});
}

export type EffectiveSettings = {
  telegram: NonNullable<Doc<"settings">["telegram"]>;
  scraper: NonNullable<Doc<"settings">["scraper"]>;
  logging: NonNullable<Doc<"settings">["logging"]>;
};

function defaultTelegram(): NonNullable<Doc<"settings">["telegram"]> {
  return {
    active: false,
    admin_chat_id: process.env.TELEGRAM_ADMIN_ID,
    group_chat_id: undefined,
    cron_expression: undefined,
    send_limit: 3,
    last_sent_at: undefined,
    send_report: false,
    report_cron_expression: undefined,
  };
}

function defaultScraper(): NonNullable<Doc<"settings">["scraper"]> {
  return {
    active: false,
    cron_expression: undefined,
    limit: 5,
    last_scraped_at: undefined,
  };
}

function defaultLogging(): NonNullable<Doc<"settings">["logging"]> {
  return {
    active: false,
    last_logged_at: undefined,
    max_retention_days: undefined,
    log_file: undefined,
    log_level: undefined,
  };
}

export async function getEffectiveSettings(): Promise<EffectiveSettings> {
  const doc = await loadSettings();
  const telegram: NonNullable<Doc<"settings">["telegram"]> = {
    ...defaultTelegram(),
    ...(doc?.telegram ?? {}),
  };
  const scraper: NonNullable<Doc<"settings">["scraper"]> = {
    ...defaultScraper(),
    ...(doc?.scraper ?? {}),
  };
  const logging: NonNullable<Doc<"settings">["logging"]> = {
    ...defaultLogging(),
    ...(doc?.logging ?? {}),
  };
  return { telegram, scraper, logging };
}
