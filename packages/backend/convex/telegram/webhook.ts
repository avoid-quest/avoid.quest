"use node";

/**
 * Telegram Webhook Handler
 * Processes incoming Telegram updates using grammY
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { createBot } from "./bot";
import { handleTextInput } from "./handlers/textInput";
import { menuMiddleware } from "./menus";

/**
 * Process a Telegram webhook update using grammY
 */
export const processUpdate = internalAction({
	args: {
		update: v.any(),
	},
	handler: async (ctx, { update }) => {
		const botToken = process.env.TELEGRAM_BOT_TOKEN;
		if (!botToken) {
			throw new Error("TELEGRAM_BOT_TOKEN not configured");
		}

		// Create bot instance with all middleware
		const bot = createBot(botToken, ctx, menuMiddleware, handleTextInput);

		// Initialize bot (fetches bot info from Telegram API)
		await bot.init();

		// Process the update
		await bot.handleUpdate(update);
	},
});
