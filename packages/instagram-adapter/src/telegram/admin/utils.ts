import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import {
  formatTimestampForLog,
  now,
} from "@workspace/backend/convex/lib/dateUtils";
import { InlineKeyboard } from "grammy";
import type { AdminContext } from "./types";

/**
 * Format scheduler status for display
 */
export function formatSchedulerStatus(status: {
  instagram: {
    active: boolean;
    nextRun: Date | null;
    cronExpression: string | undefined;
  };
  telegram: {
    active: boolean;
    nextRun: Date | null;
    cronExpression: string | undefined;
  };
}): string {
  const MS_PER_SECOND = 1000;
  const SECONDS_PER_MINUTE = 60;
  const MINUTES_PER_HOUR = 60;
  const HOURS_PER_DAY = 24;

  function formatTimeUnit(value: number, unit: string): string {
    return `in ${value} ${unit}${value > 1 ? "s" : ""}`;
  }

  const formatNextRun = (nextRun: Date | null): string => {
    if (!nextRun) {
      return "Not scheduled";
    }
    const currentTime = now();
    const diff = nextRun.getTime() - currentTime;
    const minutes = Math.floor(diff / (MS_PER_SECOND * SECONDS_PER_MINUTE));
    const hours = Math.floor(minutes / MINUTES_PER_HOUR);
    const days = Math.floor(hours / HOURS_PER_DAY);

    if (days > 0) {
      return formatTimeUnit(days, "day");
    }
    if (hours > 0) {
      return formatTimeUnit(hours, "hour");
    }
    if (minutes > 0) {
      return formatTimeUnit(minutes, "minute");
    }
    return "now";
  };

  let text = "<b>📊 Scheduler Status</b>\n\n";

  text += "<b>Instagram:</b>\n";
  text += `  Active: ${status.instagram.active ? "✅" : "❌"}\n`;
  if (status.instagram.active && status.instagram.nextRun) {
    text += `  Next run: ${formatNextRun(status.instagram.nextRun)}\n`;
    if (status.instagram.cronExpression) {
      text += `  Cron: <code>${escapeHtml(status.instagram.cronExpression)}</code>\n`;
    }
  }

  text += "\n<b>Telegram:</b>\n";
  text += `  Active: ${status.telegram.active ? "✅" : "❌"}\n`;
  if (status.telegram.active && status.telegram.nextRun) {
    text += `  Next run: ${formatNextRun(status.telegram.nextRun)}\n`;
    if (status.telegram.cronExpression) {
      text += `  Cron: <code>${escapeHtml(status.telegram.cronExpression)}</code>\n`;
    }
  }

  return text;
}

/**
 * Format settings for display
 */
export function formatSettings(settings: {
  telegram: NonNullable<Doc<"settings">["telegram"]>;
  instagram: NonNullable<Doc<"settings">["instagram"]>;
  logging: NonNullable<Doc<"settings">["logging"]>;
}): string {
  let text = "<b>⚙️ Settings</b>\n\n";

  text += "<b>Telegram:</b>\n";
  text += `  Active: ${settings.telegram.active ? "✅" : "❌"}\n`;
  text += `  Admin Chat ID: ${settings.telegram.admin_chat_id ? `<code>${escapeHtml(settings.telegram.admin_chat_id)}</code>` : "Not set"}\n`;
  text += `  Group Chat ID: ${settings.telegram.group_chat_id ? `<code>${escapeHtml(settings.telegram.group_chat_id)}</code>` : "Not set"}\n`;
  text += `  Send Limit: ${settings.telegram.send_limit ?? "Not set"}\n`;
  text += `  Cron: ${settings.telegram.cron_expression ? `<code>${escapeHtml(settings.telegram.cron_expression)}</code>` : "Not set"}\n`;
  text += `  Send Report: ${settings.telegram.send_report ? "✅" : "❌"}\n`;

  text += "\n<b>Instagram:</b>\n";
  text += `  Active: ${settings.instagram.active ? "✅" : "❌"}\n`;
  text += `  Limit: ${settings.instagram.limit ?? "Not set"}\n`;
  text += `  Cron: ${settings.instagram.cron_expression ? `<code>${escapeHtml(settings.instagram.cron_expression)}</code>` : "Not set"}\n`;

  text += "\n<b>Logging:</b>\n";
  text += `  Active: ${settings.logging.active ? "✅" : "❌"}\n`;
  text += `  Log Level: ${settings.logging.log_level ?? "Not set"}\n`;

  return text;
}

/**
 * Format post details for display
 */
export function formatPost(post: Doc<"posts">): string {
  let text = "<b>📱 Post Details</b>\n\n";
  text += `ID: <code>${post._id}</code>\n`;
  text += `Shortcode: <code>${escapeHtml(post.shortcode)}</code>\n`;
  text += `Media Type: ${post.media_type}\n`;
  text += `Is Video: ${post.is_video ? "Yes" : "No"}\n`;
  text += `Sent: ${post.sent ? "✅" : "❌"}\n`;
  if (post.sentAt) {
    text += `Sent At: ${formatTimestampForLog(post.sentAt)}\n`;
  }
  text += `Timestamp: ${formatTimestampForLog(post.timestamp)}\n`;
  text += `URL: <a href="${escapeHtml(post.url)}">View on Instagram</a>\n`;

  const MAX_CAPTION_PREVIEW_LENGTH = 200;
  const captionPreview =
    post.caption.length > MAX_CAPTION_PREVIEW_LENGTH
      ? `${post.caption.substring(0, MAX_CAPTION_PREVIEW_LENGTH)}...`
      : post.caption;
  text += `\n<b>Caption:</b>\n<code>${escapeHtml(captionPreview)}</code>`;

  return text;
}

/**
 * Format user details for display
 */
export function formatUser(user: Doc<"users">): string {
  let text = "<b>👤 User Details</b>\n\n";
  text += `ID: <code>${user._id}</code>\n`;
  text += `Username: <code>${escapeHtml(user.username)}</code>\n`;
  text += `To Be Scraped: ${user.to_be_scraped ? "✅" : "❌"}\n`;
  if (user.last_scraped_at) {
    text += `Last Scraped: ${formatTimestampForLog(user.last_scraped_at)}\n`;
  }
  if (user.profile_url) {
    text += `Profile: <a href="${escapeHtml(user.profile_url)}">View Profile</a>\n`;
  }
  return text;
}

/**
 * Escape HTML for Telegram
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build settings navigation keyboard
 */
export function buildSettingsKeyboard(currentSection?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (currentSection) {
    // Section menu with back button
    keyboard.text("⬅️ Back", "settings:back");
  } else {
    // Main menu
    keyboard
      .text("📱 Telegram", "settings:nav:telegram")
      .row()
      .text("📸 Instagram", "settings:nav:instagram")
      .row()
      .text("📝 Logging", "settings:nav:logging");
  }

  return keyboard;
}

/**
 * Build section settings keyboard
 */
export function buildSectionKeyboard(
  section: "telegram" | "instagram" | "logging",
  settings: {
    telegram: NonNullable<Doc<"settings">["telegram"]>;
    instagram: NonNullable<Doc<"settings">["instagram"]>;
    logging: NonNullable<Doc<"settings">["logging"]>;
  }
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (section === "telegram") {
    keyboard
      .text(
        `Active: ${settings.telegram.active ? "✅" : "❌"}`,
        "settings:telegram:active:toggle"
      )
      .row()
      .text("Edit Send Limit", "settings:telegram:send_limit:edit")
      .row()
      .text("Edit Cron", "settings:telegram:cron_expression:edit")
      .row()
      .text(
        `Send Report: ${settings.telegram.send_report ? "✅" : "❌"}`,
        "settings:telegram:send_report:toggle"
      )
      .row()
      .text("⬅️ Back", "settings:back");
  } else if (section === "instagram") {
    keyboard
      .text(
        `Active: ${settings.instagram.active ? "✅" : "❌"}`,
        "settings:instagram:active:toggle"
      )
      .row()
      .text("Edit Limit", "settings:instagram:limit:edit")
      .row()
      .text("Edit Cron", "settings:instagram:cron_expression:edit")
      .row()
      .text("⬅️ Back", "settings:back");
  } else if (section === "logging") {
    keyboard
      .text(
        `Active: ${settings.logging.active ? "✅" : "❌"}`,
        "settings:logging:active:toggle"
      )
      .row()
      .text("Edit Log Level", "settings:logging:log_level:edit")
      .row()
      .text("⬅️ Back", "settings:back");
  }

  return keyboard;
}

function formatTelegramSettings(
  settings: NonNullable<Doc<"settings">["telegram"]>
): string {
  let text = "";
  text += `Active: ${settings.active ? "✅" : "❌"}\n`;
  text += `Admin Chat ID: ${settings.admin_chat_id ? `<code>${escapeHtml(settings.admin_chat_id)}</code>` : "Not set"}\n`;
  text += `Group Chat ID: ${settings.group_chat_id ? `<code>${escapeHtml(settings.group_chat_id)}</code>` : "Not set"}\n`;
  text += `Send Limit: ${settings.send_limit ?? "Not set"}\n`;
  text += `Cron: ${settings.cron_expression ? `<code>${escapeHtml(settings.cron_expression)}</code>` : "Not set"}\n`;
  text += `Send Report: ${settings.send_report ? "✅" : "❌"}\n`;
  return text;
}

function formatInstagramSettings(
  settings: NonNullable<Doc<"settings">["instagram"]>
): string {
  let text = "";
  text += `Active: ${settings.active ? "✅" : "❌"}\n`;
  text += `Limit: ${settings.limit ?? "Not set"}\n`;
  text += `Cron: ${settings.cron_expression ? `<code>${escapeHtml(settings.cron_expression)}</code>` : "Not set"}\n`;
  return text;
}

function formatLoggingSettings(
  settings: NonNullable<Doc<"settings">["logging"]>
): string {
  let text = "";
  text += `Active: ${settings.active ? "✅" : "❌"}\n`;
  text += `Log Level: ${settings.log_level ?? "Not set"}\n`;
  return text;
}

/**
 * Format section settings for display
 */
export function formatSectionSettings(
  section: "telegram" | "instagram" | "logging",
  settings: {
    telegram: NonNullable<Doc<"settings">["telegram"]>;
    instagram: NonNullable<Doc<"settings">["instagram"]>;
    logging: NonNullable<Doc<"settings">["logging"]>;
  }
): string {
  const sectionTitle = section.charAt(0).toUpperCase() + section.slice(1);
  let text = `<b>⚙️ ${sectionTitle} Settings</b>\n\n`;

  if (section === "telegram") {
    text += formatTelegramSettings(settings.telegram);
  } else if (section === "instagram") {
    text += formatInstagramSettings(settings.instagram);
  } else if (section === "logging") {
    text += formatLoggingSettings(settings.logging);
  }

  return text;
}

/**
 * Navigate to main menu and reset session state
 */
export async function navigateToMainMenu(ctx: AdminContext): Promise<void> {
  // Reset session state
  ctx.session.usersPage = { cursor: null, page: 1 };
  ctx.session.postsPage = { cursor: null, page: 1, filter: "all" };
  ctx.session.settingsSection = null;
  ctx.session.pendingInput = null;

  // Navigate to main menu
  const { mainMenu } = await import("./menus/main-menu");
  await ctx.editMessageText("👋 Welcome to Admin Bot!\n\nSelect an option:", {
    parse_mode: "HTML",
    reply_markup: mainMenu,
  });
}
