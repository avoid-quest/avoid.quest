"use node";

/**
 * Instarip Quick Actions Menu Template
 * Trigger Instagram fetch and Telegram send manually
 */

import { MenuTemplate } from "grammy-inline-menu";
import { internal } from "../../_generated/api";
import type { InstaripBotContext } from "../bot";

export const actionsMenu = new MenuTemplate<InstaripBotContext>({
	text: "⚡ <b>Quick Actions</b>\n\nTrigger jobs manually:",
	parse_mode: "HTML",
});

/**
 * Trigger Instagram fetch
 */
actionsMenu.interact("instagram", {
	text: "📸 Fetch Instagram",
	do: async (ctx) => {
		await ctx.reply("⏳ Triggering Instagram fetch...");

		try {
			const result = (await ctx.convex.runAction(
				internal.crons.runInstagramFetch,
				{},
			)) as {
				skipped?: boolean;
				usersProcessed?: number;
				newPosts?: number;
				errors?: string[];
			};

			if (result.skipped) {
				await ctx.reply("⏭️ Skipped (inactive)");
				return false;
			}

			let text = `✅ <b>Instagram Fetch Complete</b>
Users: ${result.usersProcessed ?? 0}
New Posts: ${result.newPosts ?? 0}`;

			if (result.errors?.length) {
				text += `\n\n⚠️ Errors:\n${result.errors.slice(0, 3).join("\n")}`;
			}

			await ctx.reply(text, { parse_mode: "HTML" });
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Unknown error";
			await ctx.reply(`❌ Failed: ${msg}`);
		}

		return false;
	},
});

/**
 * Trigger Telegram send
 */
actionsMenu.interact("telegram", {
	text: "📱 Send Telegram",
	do: async (ctx) => {
		await ctx.reply("⏳ Triggering Telegram send...");

		try {
			const result = (await ctx.convex.runAction(
				internal.crons.runTelegramSend,
				{},
			)) as {
				skipped?: boolean;
				sent?: number;
				failed?: number;
				errors?: string[];
			};

			if (result.skipped) {
				await ctx.reply("⏭️ Skipped (inactive)");
				return false;
			}

			let text = `✅ <b>Telegram Send Complete</b>
Sent: ${result.sent ?? 0}
Failed: ${result.failed ?? 0}`;

			if (result.errors?.length) {
				text += `\n\n⚠️ Errors:\n${result.errors.slice(0, 3).join("\n")}`;
			}

			await ctx.reply(text, { parse_mode: "HTML" });
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Unknown error";
			await ctx.reply(`❌ Failed: ${msg}`);
		}

		return false;
	},
});

/**
 * Back to main menu
 */
actionsMenu.navigate("..", { text: "⬅️ Back to Menu" });
