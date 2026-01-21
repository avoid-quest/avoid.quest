"use node";

/**
 * Settings Menu Template
 * Manage all bot settings (Telegram, Instagram, Locale, Logging)
 */

import { MenuTemplate } from "grammy-inline-menu";
import { internal } from "../../_generated/api";
import type { BotContext } from "../bot";

/**
 * Telegram settings submenu
 */
const telegramSettingsMenu = new MenuTemplate<BotContext>(async (ctx) => {
	const settings = await ctx.convex.runQuery(
		internal.settings.getSettingsInternal,
		{},
	);
	const telegram = settings?.telegram;

	const status = telegram?.active ? "✅ Active" : "❌ Inactive";
	const reportStatus = telegram?.send_report ? "✅ On" : "❌ Off";

	return `<b>📱 Telegram Settings</b>

Status: ${status}
Send Report: ${reportStatus}
Group Chat ID: ${telegram?.group_chat_id ?? "Not set"}
Send Limit: ${telegram?.send_limit ?? 3}
Request Timeout: ${telegram?.request_timeout_ms ?? 30000}ms
Delay Between Posts: ${telegram?.delay_between_posts_ms ?? 1000}ms`;
});

telegramSettingsMenu.interact("toggle_active", {
	text: (ctx) => "🔄 Toggle Active",
	do: async (ctx) => {
		await ctx.convex.runMutation(
			internal.settings.toggleTelegramActiveInternal,
			{},
		);
		return true;
	},
});

telegramSettingsMenu.interact("toggle_report", {
	text: "🔄 Toggle Report",
	do: async (ctx) => {
		await ctx.convex.runMutation(
			internal.settings.toggleTelegramReportInternal,
			{},
		);
		return true;
	},
});

telegramSettingsMenu.interact("edit_group_id", {
	text: "✏️ Edit Group ID",
	do: async (ctx) => {
		ctx.session.awaitingInput = {
			type: "edit_setting",
			settingPath: "telegram.group_chat_id",
		};
		await ctx.reply("Enter the Telegram group chat ID:");
		return false;
	},
});

telegramSettingsMenu.interact("edit_send_limit", {
	text: "✏️ Edit Send Limit",
	do: async (ctx) => {
		ctx.session.awaitingInput = {
			type: "edit_setting",
			settingPath: "telegram.send_limit",
		};
		await ctx.reply("Enter the send limit (number of posts per batch):");
		return false;
	},
});

telegramSettingsMenu.navigate("..", { text: "⬅️ Back" });

/**
 * Instagram settings submenu
 */
const instagramSettingsMenu = new MenuTemplate<BotContext>(async (ctx) => {
	const settings = await ctx.convex.runQuery(
		internal.settings.getSettingsInternal,
		{},
	);
	const instagram = settings?.instagram;

	const status = instagram?.active ? "✅ Active" : "❌ Inactive";

	return `<b>📸 Instagram Settings</b>

Status: ${status}
User Limit: ${instagram?.limit ?? 5}
Posts Per User: ${instagram?.post_per_user ?? 20}
Request Timeout: ${instagram?.request_timeout_ms ?? 30000}ms
Min Scrape Interval: ${instagram?.min_scrape_interval_ms ?? 3600000}ms`;
});

instagramSettingsMenu.interact("toggle_active", {
	text: "🔄 Toggle Active",
	do: async (ctx) => {
		await ctx.convex.runMutation(
			internal.settings.toggleInstagramActiveInternal,
			{},
		);
		return true;
	},
});

instagramSettingsMenu.interact("edit_limit", {
	text: "✏️ Edit User Limit",
	do: async (ctx) => {
		ctx.session.awaitingInput = {
			type: "edit_setting",
			settingPath: "instagram.limit",
		};
		await ctx.reply("Enter the user limit (number of users to scrape):");
		return false;
	},
});

instagramSettingsMenu.interact("edit_posts_per_user", {
	text: "✏️ Edit Posts/User",
	do: async (ctx) => {
		ctx.session.awaitingInput = {
			type: "edit_setting",
			settingPath: "instagram.post_per_user",
		};
		await ctx.reply("Enter posts per user limit:");
		return false;
	},
});

instagramSettingsMenu.navigate("..", { text: "⬅️ Back" });

/**
 * Locale settings submenu
 */
const localeSettingsMenu = new MenuTemplate<BotContext>(async (ctx) => {
	const settings = await ctx.convex.runQuery(
		internal.settings.getSettingsInternal,
		{},
	);
	const locale = settings?.locale;

	return `<b>🌍 Locale Settings</b>

Timezone: ${locale?.timezone ?? "Europe/Rome"}
Locale: ${locale?.locale ?? "it-IT"}`;
});

localeSettingsMenu.interact("edit_timezone", {
	text: "✏️ Edit Timezone",
	do: async (ctx) => {
		ctx.session.awaitingInput = {
			type: "edit_setting",
			settingPath: "locale.timezone",
		};
		await ctx.reply(
			"Enter the timezone (e.g., Europe/Rome, America/New_York):",
		);
		return false;
	},
});

localeSettingsMenu.interact("edit_locale", {
	text: "✏️ Edit Locale",
	do: async (ctx) => {
		ctx.session.awaitingInput = {
			type: "edit_setting",
			settingPath: "locale.locale",
		};
		await ctx.reply("Enter the locale (e.g., it-IT, en-US):");
		return false;
	},
});

localeSettingsMenu.navigate("..", { text: "⬅️ Back" });

/**
 * Logging settings submenu
 */
const loggingSettingsMenu = new MenuTemplate<BotContext>(async (ctx) => {
	const settings = await ctx.convex.runQuery(
		internal.settings.getSettingsInternal,
		{},
	);
	const logging = settings?.logging;

	const status = logging?.active ? "✅ Active" : "❌ Inactive";

	return `<b>📋 Logging Settings</b>

Status: ${status}
Log Level: ${logging?.log_level ?? "info"}
Max Retention: ${logging?.max_retention_days ?? 30} days`;
});

loggingSettingsMenu.interact("toggle_active", {
	text: "🔄 Toggle Active",
	do: async (ctx) => {
		await ctx.convex.runMutation(
			internal.settings.toggleLoggingActiveInternal,
			{},
		);
		return true;
	},
});

loggingSettingsMenu.interact("edit_log_level", {
	text: "✏️ Edit Log Level",
	do: async (ctx) => {
		ctx.session.awaitingInput = {
			type: "edit_setting",
			settingPath: "logging.log_level",
		};
		await ctx.reply("Enter log level (debug, info, warn, error):");
		return false;
	},
});

loggingSettingsMenu.navigate("..", { text: "⬅️ Back" });

/**
 * Main settings menu
 */
export const settingsMenu = new MenuTemplate<BotContext>(
	"⚙️ <b>Settings</b>\n\nConfigure bot behavior:",
);

settingsMenu.submenu("telegram", telegramSettingsMenu, {
	text: "📱 Telegram",
});

settingsMenu.submenu("instagram", instagramSettingsMenu, {
	text: "📸 Instagram",
});

settingsMenu.submenu("locale", localeSettingsMenu, {
	text: "🌍 Locale",
});

settingsMenu.submenu("logging", loggingSettingsMenu, {
	text: "📋 Logging",
});

settingsMenu.navigate("..", { text: "⬅️ Back to Menu" });
