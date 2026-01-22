"use node";

/**
 * Instarip Settings Menu Template
 * Manage all bot settings (Telegram, Instagram, Locale, Logging)
 */

import type { FunctionReference } from "convex/server";
import { MenuTemplate } from "grammy-inline-menu";
import { components } from "../../_generated/api";
import type { InstaripBotContext } from "../bot";

/**
 * Helper to add an edit field interaction to a menu
 */
function addEditField(
	menu: MenuTemplate<InstaripBotContext>,
	id: string,
	label: string,
	settingPath: string,
	prompt: string,
) {
	menu.interact(id, {
		text: `✏️ ${label}`,
		do: async (ctx) => {
			ctx.session.awaitingInput = { type: "edit_setting", settingPath };
			await ctx.reply(prompt);
			return false;
		},
	});
}

/**
 * Helper to add a toggle interaction to a menu
 */
function addToggle(
	menu: MenuTemplate<InstaripBotContext>,
	id: string,
	label: string,
	// biome-ignore lint/suspicious/noExplicitAny: Convex mutation reference type
	mutation: FunctionReference<"mutation", any>,
) {
	menu.interact(id, {
		text: `🔄 ${label}`,
		do: async (ctx) => {
			await ctx.convex.runMutation(mutation, {});
			return true;
		},
	});
}

/**
 * Telegram settings submenu
 */
const telegramSettingsMenu = new MenuTemplate<InstaripBotContext>(
	async (ctx) => {
		const settings = await ctx.convex.runQuery(
			components.instarip.settings.getSettings,
			{},
		);
		const telegram = settings?.telegram;

		const status = telegram?.active ? "✅ Active" : "❌ Inactive";
		const reportStatus = telegram?.send_report ? "✅ On" : "❌ Off";

		return {
			text: `<b>📱 Telegram Settings</b>

Status: ${status}
Send Report: ${reportStatus}
Group Chat ID: ${telegram?.group_chat_id ?? "Not set"}
Send Limit: ${telegram?.send_limit ?? 3}
Request Timeout: ${telegram?.request_timeout_ms ?? 30000}ms
Delay Between Posts: ${telegram?.delay_between_posts_ms ?? 1000}ms`,
			parse_mode: "HTML" as const,
		};
	},
);

addToggle(
	telegramSettingsMenu,
	"toggle_active",
	"Toggle Active",
	components.instarip.settings.toggleTelegramActive,
);
addToggle(
	telegramSettingsMenu,
	"toggle_report",
	"Toggle Report",
	components.instarip.settings.toggleTelegramReport,
);
addEditField(
	telegramSettingsMenu,
	"edit_group_id",
	"Edit Group ID",
	"telegram.group_chat_id",
	"Enter the Telegram group chat ID:",
);
addEditField(
	telegramSettingsMenu,
	"edit_send_limit",
	"Edit Send Limit",
	"telegram.send_limit",
	"Enter the send limit (number of posts per batch):",
);
telegramSettingsMenu.navigate("..", { text: "⬅️ Back" });

/**
 * Instagram settings submenu
 */
const instagramSettingsMenu = new MenuTemplate<InstaripBotContext>(
	async (ctx) => {
		const settings = await ctx.convex.runQuery(
			components.instarip.settings.getSettings,
			{},
		);
		const instagram = settings?.instagram;

		const status = instagram?.active ? "✅ Active" : "❌ Inactive";

		return {
			text: `<b>📸 Instagram Settings</b>

Status: ${status}
User Limit: ${instagram?.limit ?? 5}
Posts Per User: ${instagram?.post_per_user ?? 20}
Request Timeout: ${instagram?.request_timeout_ms ?? 30000}ms
Min Scrape Interval: ${instagram?.min_scrape_interval_ms ?? 3600000}ms`,
			parse_mode: "HTML" as const,
		};
	},
);

addToggle(
	instagramSettingsMenu,
	"toggle_active",
	"Toggle Active",
	components.instarip.settings.toggleInstagramActive,
);
addEditField(
	instagramSettingsMenu,
	"edit_limit",
	"Edit User Limit",
	"instagram.limit",
	"Enter the user limit (number of users to scrape):",
);
addEditField(
	instagramSettingsMenu,
	"edit_posts_per_user",
	"Edit Posts/User",
	"instagram.post_per_user",
	"Enter posts per user limit:",
);
instagramSettingsMenu.navigate("..", { text: "⬅️ Back" });

/**
 * Locale settings submenu
 */
const localeSettingsMenu = new MenuTemplate<InstaripBotContext>(async (ctx) => {
	const settings = await ctx.convex.runQuery(
		components.instarip.settings.getSettings,
		{},
	);
	const locale = settings?.locale;

	return {
		text: `<b>🌍 Locale Settings</b>

Timezone: ${locale?.timezone ?? "Europe/Rome"}
Locale: ${locale?.locale ?? "it-IT"}`,
		parse_mode: "HTML" as const,
	};
});

addEditField(
	localeSettingsMenu,
	"edit_timezone",
	"Edit Timezone",
	"locale.timezone",
	"Enter the timezone (e.g., Europe/Rome, America/New_York):",
);
addEditField(
	localeSettingsMenu,
	"edit_locale",
	"Edit Locale",
	"locale.locale",
	"Enter the locale (e.g., it-IT, en-US):",
);
localeSettingsMenu.navigate("..", { text: "⬅️ Back" });

/**
 * Logging settings submenu
 */
const loggingSettingsMenu = new MenuTemplate<InstaripBotContext>(
	async (ctx) => {
		const settings = await ctx.convex.runQuery(
			components.instarip.settings.getSettings,
			{},
		);
		const logging = settings?.logging;

		const status = logging?.active ? "✅ Active" : "❌ Inactive";

		return {
			text: `<b>📋 Logging Settings</b>

Status: ${status}
Log Level: ${logging?.log_level ?? "info"}
Max Retention: ${logging?.max_retention_days ?? 30} days`,
			parse_mode: "HTML" as const,
		};
	},
);

addToggle(
	loggingSettingsMenu,
	"toggle_active",
	"Toggle Active",
	components.instarip.settings.toggleLoggingActive,
);
addEditField(
	loggingSettingsMenu,
	"edit_log_level",
	"Edit Log Level",
	"logging.log_level",
	"Enter log level (debug, info, warn, error):",
);
loggingSettingsMenu.navigate("..", { text: "⬅️ Back" });

/**
 * Main settings menu
 */
export const settingsMenu = new MenuTemplate<InstaripBotContext>({
	text: "⚙️ <b>Settings</b>\n\nConfigure bot behavior:",
	parse_mode: "HTML",
});

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
