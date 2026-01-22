/**
 * HTTP router for Convex
 * Handles external webhook requests
 *
 * Webhook routes are organized by app:
 * - /telegram/instarip/webhook - Instarip bot webhook
 */

import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { mediaHandler } from "./httpHandlers/media";
import { createLogger } from "./lib/logger";
import { secureCompare } from "./lib/security";

const logger = createLogger("http");

const http = httpRouter();

// Reference internal to keep it as a runtime import
const instaripWebhook = internal.instarip.webhook.processUpdate;

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
 * Shared webhook handler for Telegram updates
 * Validates the request and routes to the appropriate app handler
 */
const createTelegramWebhookHandler = (
	processUpdateAction: typeof instaripWebhook,
) =>
	httpAction(async (ctx, request) => {
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

		// Declare outside try for error logging access
		let update: TelegramUpdate | undefined;
		let chatId: string | undefined;

		try {
			update = (await request.json()) as TelegramUpdate;
			const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

			// Get chat ID from message or callback
			chatId =
				update.message?.chat.id.toString() ??
				update.callback_query?.message?.chat.id.toString();

			if (!chatId) {
				return new Response("OK", { status: 200 });
			}

			// Check admin authorization - silently ignore non-admin messages
			if (adminChatId && chatId !== adminChatId) {
				logger.info(
					`Telegram webhook: ignoring non-admin message chatId=${chatId} updateId=${update.update_id}`,
				);
				return new Response("OK", { status: 200 });
			}

			// Process the update via the app's webhook handler (runs in Node.js runtime)
			await ctx.runAction(processUpdateAction, {
				update,
			});

			return new Response("OK", { status: 200 });
		} catch (error) {
			// Error handling: return OK to prevent Telegram from retrying
			// Log error for debugging but don't expose internal errors to Telegram
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error(
				`Telegram webhook error: updateId=${update?.update_id} chatId=${chatId} error=${errorMsg}`,
			);
			return new Response("OK", { status: 200 });
		}
	});

/**
 * Instarip Telegram webhook endpoint
 * Primary endpoint for the Instarip bot
 */
http.route({
	path: "/telegram/instarip/webhook",
	method: "POST",
	handler: createTelegramWebhookHandler(instaripWebhook),
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

/**
 * Media proxy OPTIONS endpoint for CORS preflight
 */
http.route({
	path: "/media",
	method: "OPTIONS",
	handler: mediaHandler,
});

export default http;
