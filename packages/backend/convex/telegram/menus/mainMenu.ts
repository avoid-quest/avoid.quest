"use node";

/**
 * Main Menu Template
 * Root menu for the Telegram bot admin interface
 */

import { MenuTemplate } from "grammy-inline-menu";
import { internal } from "../../_generated/api";
import type { BotContext } from "../bot";
import { actionsMenu } from "./actionsMenu";
import { settingsMenu } from "./settingsMenu";
import { usersMenu } from "./usersMenu";

export const mainMenu = new MenuTemplate<BotContext>({
	text: "🤖 <b>Admin Panel</b>\n\nSelect an option:",
	parse_mode: "HTML",
});

/**
 * Status button - shows system status
 */
mainMenu.interact("status", {
	text: "📊 Status",
	do: async (ctx) => {
		try {
			const settings = await ctx.convex.runQuery(
				internal.settings.getSettingsInternal,
				{},
			);

			if (!settings) {
				await ctx.reply("⚠️ No settings found.");
				return false;
			}

			const telegramStatus = settings.telegram?.active
				? "✅ Active"
				: "❌ Inactive";
			const instagramStatus = settings.instagram?.active
				? "✅ Active"
				: "❌ Inactive";
			const lastSentAt = settings.telegram?.last_sent_at
				? new Date(settings.telegram.last_sent_at).toLocaleString()
				: "Never";
			const lastScrapedAt = settings.instagram?.last_scraped_at
				? new Date(settings.instagram.last_scraped_at).toLocaleString()
				: "Never";

			await ctx.reply(
				`<b>📊 System Status</b>

<b>📱 Telegram</b>
Status: ${telegramStatus}
Group: ${settings.telegram?.group_chat_id ?? "Not set"}
Limit: ${settings.telegram?.send_limit ?? 3}
Last Sent: ${lastSentAt}

<b>📸 Instagram</b>
Status: ${instagramStatus}
Users: ${settings.instagram?.limit ?? 5}
Posts/User: ${settings.instagram?.post_per_user ?? 20}
Last Scraped: ${lastScrapedAt}`,
				{ parse_mode: "HTML" },
			);
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Unknown error";
			await ctx.reply(`❌ Error: ${msg}`);
		}
		return false; // Don't update menu
	},
});

/**
 * Users submenu
 */
mainMenu.submenu("users", usersMenu, { text: "👥 Users" });

/**
 * Settings submenu
 */
mainMenu.submenu("settings", settingsMenu, { text: "⚙️ Settings" });

/**
 * Quick Actions submenu
 */
mainMenu.submenu("actions", actionsMenu, { text: "⚡ Quick Actions" });

/**
 * Stats button - shows database statistics
 */
mainMenu.interact("stats", {
	text: "📈 Stats",
	do: async (ctx) => {
		try {
			const unsent = await ctx.convex.runQuery(
				internal.posts.getUnsentInternal,
				{ limit: 1000 },
			);
			const users = await ctx.convex.runQuery(
				internal.users.listToBeScrapedInternal,
				{ limit: 1000 },
			);

			await ctx.reply(
				`<b>📊 Database Statistics</b>

<b>📱 Posts</b>
Unsent: ${unsent.length}

<b>👥 Users</b>
Active: ${users.length}`,
				{ parse_mode: "HTML" },
			);
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Unknown error";
			await ctx.reply(`❌ Error: ${msg}`);
		}
		return false; // Don't update menu
	},
});
