"use node";

/**
 * Instarip Webhook Handler
 * Processes incoming Telegram updates for Instarip app using grammY
 */

import { v } from "convex/values";
import type { Update } from "grammy/types";
import { internalAction } from "../_generated/server";
import { createInstaripBot } from "./bot";
import { handleTextInput } from "./handlers/textInput";
import { menuMiddleware } from "./menu";

/**
 * Telegram update validator
 * Validates the essential structure (update_id) while allowing grammY to handle
 * the complex nested message/callback_query parsing.
 */
const telegramUpdateValidator = v.object({
	update_id: v.number(),
	// Message and callback_query have complex nested structures that grammY handles
	message: v.optional(v.any()),
	callback_query: v.optional(v.any()),
	// Other update types that Telegram may send
	edited_message: v.optional(v.any()),
	channel_post: v.optional(v.any()),
	edited_channel_post: v.optional(v.any()),
	inline_query: v.optional(v.any()),
	chosen_inline_result: v.optional(v.any()),
	shipping_query: v.optional(v.any()),
	pre_checkout_query: v.optional(v.any()),
	poll: v.optional(v.any()),
	poll_answer: v.optional(v.any()),
	my_chat_member: v.optional(v.any()),
	chat_member: v.optional(v.any()),
	chat_join_request: v.optional(v.any()),
});

/**
 * Process a Telegram webhook update for Instarip app
 */
export const processUpdate = internalAction({
	args: {
		update: telegramUpdateValidator,
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

		// Process the update - cast to Update since we validated the structure
		await bot.handleUpdate(update as Update);
	},
});
