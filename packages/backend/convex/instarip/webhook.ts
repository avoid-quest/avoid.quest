"use node";

/**
 * Instarip Webhook Handler
 * Processes incoming Telegram updates for Instarip app using grammY
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { createInstaripBot } from "./bot";
import { handleTextInput } from "./handlers/textInput";
import { menuMiddleware } from "./menu";

/**
 * Process a Telegram webhook update for Instarip app
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
		const bot = createInstaripBot(
			botToken,
			ctx,
			menuMiddleware,
			handleTextInput,
		);

		// Initialize bot (fetches bot info from Telegram API)
		await bot.init();

		// Process the update
		await bot.handleUpdate(update);
	},
});
