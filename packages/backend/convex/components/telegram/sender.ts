/**
 * Telegram message sending actions
 * These actions handle the Telegram API calls - database access is done by the main app
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import {
	createTelegramClient,
	getRetryAfterMs,
	isApiError,
	isRateLimited,
	isRecoverableError,
} from "./lib/apiClient";
import { buildCaption } from "./lib/captionBuilder";
import {
	buildMediaGroup,
	determineSendStrategy,
	type MediaItemInput,
} from "./lib/mediaBuilder";

const mediaItemValidator = v.object({
	url: v.optional(v.string()),
	file_id: v.optional(v.string()),
	type: v.union(v.literal("image"), v.literal("video"), v.literal("thumbnail")),
	width: v.optional(v.number()),
	height: v.optional(v.number()),
});

export type SendResult = {
	success: boolean;
	messageId?: number;
	error?: string;
	retryAfterMs?: number;
};

/**
 * Send a single post to Telegram
 * Handles media groups, single media, and text-only posts
 */
export const sendMessage = action({
	args: {
		chatId: v.string(),
		caption: v.string(),
		mediaItems: v.array(mediaItemValidator),
		postUrl: v.string(),
	},
	returns: v.object({
		success: v.boolean(),
		messageId: v.optional(v.number()),
		error: v.optional(v.string()),
		retryAfterMs: v.optional(v.number()),
	}),
	handler: async (
		_ctx,
		{ chatId, caption, mediaItems, postUrl },
	): Promise<SendResult> => {
		const botToken = process.env.TELEGRAM_BOT_TOKEN;
		if (!botToken) {
			return { success: false, error: "TELEGRAM_BOT_TOKEN not configured" };
		}

		const client = createTelegramClient(botToken);
		const formattedCaption = buildCaption({ caption, postUrl });
		const strategy = determineSendStrategy(mediaItems as MediaItemInput[]);

		try {
			if (strategy.type === "text") {
				// No media - send as text message
				const response = await client.sendMessage({
					chat_id: chatId,
					text: formattedCaption,
					parse_mode: "HTML",
				});

				if (isApiError(response)) {
					return handleApiError(response);
				}

				return { success: true, messageId: response.result.message_id };
			}

			if (strategy.type === "single") {
				// Single media item
				const item = strategy.item;
				const media = item.file_id ?? item.url;

				if (!media) {
					return { success: false, error: "No valid media source" };
				}

				if (item.type === "image") {
					const response = await client.sendPhoto({
						chat_id: chatId,
						photo: media,
						caption: formattedCaption,
						parse_mode: "HTML",
					});

					if (isApiError(response)) {
						return handleApiError(response);
					}

					return { success: true, messageId: response.result.message_id };
				}

				// Video
				const response = await client.sendVideo({
					chat_id: chatId,
					video: media,
					caption: formattedCaption,
					parse_mode: "HTML",
					width: item.width,
					height: item.height,
					supports_streaming: true,
				});

				if (isApiError(response)) {
					return handleApiError(response);
				}

				return { success: true, messageId: response.result.message_id };
			}

			// Media group
			const mediaGroup = buildMediaGroup(
				strategy.items as MediaItemInput[],
				formattedCaption,
			);

			const response = await client.sendMediaGroup({
				chat_id: chatId,
				media: mediaGroup,
			});

			if (isApiError(response)) {
				return handleApiError(response);
			}

			// Return first message ID for tracking
			return { success: true, messageId: response.result[0]?.message_id };
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			return { success: false, error: message };
		}
	},
});

function handleApiError(error: {
	ok: false;
	error_code: number;
	description: string;
	parameters?: { retry_after?: number };
}): SendResult {
	if (isRateLimited(error)) {
		return {
			success: false,
			error: `Rate limited: ${error.description}`,
			retryAfterMs: getRetryAfterMs(error),
		};
	}

	if (isRecoverableError(error)) {
		return {
			success: false,
			error: `Recoverable error: ${error.description}`,
		};
	}

	return {
		success: false,
		error: `Telegram API error ${error.error_code}: ${error.description}`,
	};
}

/**
 * Send a simple text message (for notifications, reports, etc.)
 */
export const sendTextMessage = action({
	args: {
		chatId: v.string(),
		text: v.string(),
		disableNotification: v.optional(v.boolean()),
	},
	returns: v.object({
		success: v.boolean(),
		messageId: v.optional(v.number()),
		error: v.optional(v.string()),
	}),
	handler: async (_ctx, { chatId, text, disableNotification }) => {
		const botToken = process.env.TELEGRAM_BOT_TOKEN;
		if (!botToken) {
			return { success: false, error: "TELEGRAM_BOT_TOKEN not configured" };
		}

		const client = createTelegramClient(botToken);

		try {
			const response = await client.sendMessage({
				chat_id: chatId,
				text,
				parse_mode: "HTML",
				disable_notification: disableNotification,
			});

			if (isApiError(response)) {
				return {
					success: false,
					error: `Telegram API error ${response.error_code}: ${response.description}`,
				};
			}

			return { success: true, messageId: response.result.message_id };
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			return { success: false, error: message };
		}
	},
});

/**
 * Verify bot token is valid
 */
export const verifyBotToken = action({
	args: {},
	returns: v.object({
		success: v.boolean(),
		botUsername: v.optional(v.string()),
		error: v.optional(v.string()),
	}),
	handler: async () => {
		const botToken = process.env.TELEGRAM_BOT_TOKEN;
		if (!botToken) {
			return { success: false, error: "TELEGRAM_BOT_TOKEN not configured" };
		}

		const client = createTelegramClient(botToken);

		try {
			const response = await client.getMe();

			if (isApiError(response)) {
				return {
					success: false,
					error: `Invalid bot token: ${response.description}`,
				};
			}

			return { success: true, botUsername: response.result.username };
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			return { success: false, error: message };
		}
	},
});
