/**
 * HTTP router for Convex
 * Handles external webhook requests
 */

import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { mediaHandler } from "./httpHandlers/media";
import { secureCompare } from "./lib/security";

const http = httpRouter();

/**
 * Telegram Update type (simplified for admin check)
 */
type TelegramUpdate = {
	update_id: number;
	message?: {
		chat: { id: number };
	};
	callback_query?: {
		message?: { chat: { id: number } };
	};
};

/**
 * Telegram webhook endpoint
 * Receives updates from Telegram Bot API and processes them via grammY
 */
http.route({
	path: "/telegram/webhook",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		// Verify webhook secret (mandatory for security)
		const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
		const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
		if (!expectedSecret) {
			return new Response("TELEGRAM_WEBHOOK_SECRET not configured", {
				status: 500,
			});
		}
		if (!secret || !(await secureCompare(secret, expectedSecret))) {
			return new Response("Unauthorized", { status: 401 });
		}

		try {
			const update = (await request.json()) as TelegramUpdate;
			const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

			// Get chat ID from message or callback
			const chatId =
				update.message?.chat.id.toString() ??
				update.callback_query?.message?.chat.id.toString();

			if (!chatId) {
				return new Response("OK", { status: 200 });
			}

			// Check admin authorization - silently ignore non-admin messages
			if (adminChatId && chatId !== adminChatId) {
				return new Response("OK", { status: 200 });
			}

			// Process the update via grammY (runs in Node.js runtime)
			await ctx.runAction(internal.telegram.webhook.processUpdate, {
				update,
			});

			return new Response("OK", { status: 200 });
		} catch (error) {
			// Error handling: return OK to prevent Telegram from retrying
			// Log error for debugging but don't expose internal errors to Telegram
			console.error(
				"Telegram webhook error:",
				error instanceof Error ? error.message : error,
			);
			return new Response("OK", { status: 200 });
		}
	}),
});

/**
 * Health check endpoint
 */
http.route({
	path: "/health",
	method: "GET",
	handler: httpAction(async () => {
		return new Response(JSON.stringify({ status: "ok" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}),
});

/**
 * Media proxy endpoint
 * Returns media files with aggressive caching headers
 * URL format: /media?id=<media_item_id>
 */
http.route({
	path: "/media",
	method: "GET",
	handler: mediaHandler,
});

export default http;
