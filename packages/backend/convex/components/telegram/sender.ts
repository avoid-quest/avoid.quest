/**
 * Telegram message sending actions
 * These actions handle the Telegram API calls - database access is done by the main app
 */

import { v } from "convex/values";
import {
	fileIdInfoValidator,
	telegramMediaItemValidator,
} from "../../lib/validators";

// Re-export FileIdInfo for backwards compatibility
export type { FileIdInfo } from "../../lib/validators";

// Local import for use in this file
import type { FileIdInfo } from "../../lib/validators";
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

export type SendResult = {
	success: boolean;
	messageId?: number;
	error?: string;
	retryAfterMs?: number;
	fileIds?: FileIdInfo[];
};

/**
 * Send a single post to Telegram
 * Handles media groups, single media, and text-only posts
 */
export const sendMessage = action({
	args: {
		botToken: v.string(),
		chatId: v.string(),
		caption: v.string(),
		mediaItems: v.array(telegramMediaItemValidator),
		postUrl: v.string(),
	},
	returns: v.object({
		success: v.boolean(),
		messageId: v.optional(v.number()),
		error: v.optional(v.string()),
		retryAfterMs: v.optional(v.number()),
		fileIds: v.optional(v.array(fileIdInfoValidator)),
	}),
	handler: async (
		_ctx,
		{ botToken, chatId, caption, mediaItems, postUrl },
	): Promise<SendResult> => {
		if (!botToken) {
			return { success: false, error: "botToken is required" };
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

					// Extract file_id from the largest photo size
					const fileIds: FileIdInfo[] = [];
					const photos = response.result.photo;
					if (photos && photos.length > 0) {
						const largest = photos[photos.length - 1];
						fileIds.push({
							file_id: largest.file_id,
							file_unique_id: largest.file_unique_id,
							type: "image",
						});
					}

					return {
						success: true,
						messageId: response.result.message_id,
						fileIds: fileIds.length > 0 ? fileIds : undefined,
					};
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

				// Extract file_id from video
				const fileIds: FileIdInfo[] = [];
				const videoInfo = response.result.video;
				if (videoInfo) {
					fileIds.push({
						file_id: videoInfo.file_id,
						file_unique_id: videoInfo.file_unique_id,
						type: "video",
					});
				}

				return {
					success: true,
					messageId: response.result.message_id,
					fileIds: fileIds.length > 0 ? fileIds : undefined,
				};
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

			// Extract file_ids from all messages in the group
			const fileIds: FileIdInfo[] = [];
			for (const msg of response.result) {
				if (msg.photo && msg.photo.length > 0) {
					// Get the largest photo size
					const largest = msg.photo[msg.photo.length - 1];
					fileIds.push({
						file_id: largest.file_id,
						file_unique_id: largest.file_unique_id,
						type: "image",
					});
				} else if (msg.video) {
					fileIds.push({
						file_id: msg.video.file_id,
						file_unique_id: msg.video.file_unique_id,
						type: "video",
					});
				}
			}

			// Return first message ID for tracking
			return {
				success: true,
				messageId: response.result[0]?.message_id,
				fileIds: fileIds.length > 0 ? fileIds : undefined,
			};
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
		botToken: v.string(),
		chatId: v.string(),
		text: v.string(),
		disableNotification: v.optional(v.boolean()),
	},
	returns: v.object({
		success: v.boolean(),
		messageId: v.optional(v.number()),
		error: v.optional(v.string()),
	}),
	handler: async (_ctx, { botToken, chatId, text, disableNotification }) => {
		if (!botToken) {
			return { success: false, error: "botToken is required" };
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
	args: {
		botToken: v.string(),
	},
	returns: v.object({
		success: v.boolean(),
		botUsername: v.optional(v.string()),
		error: v.optional(v.string()),
	}),
	handler: async (_ctx, { botToken }) => {
		if (!botToken) {
			return { success: false, error: "botToken is required" };
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
