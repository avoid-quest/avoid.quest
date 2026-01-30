/**
 * Admin actions for Telegram component
 * Internal use only - for data management and cleanup
 */
import { v } from "convex/values";
import { action } from "./_generated/server";
import { createTelegramClient, isApiError } from "./lib/apiClient";

export type DeleteMessagesResult = {
	success: boolean;
	deleted: number;
	failed: number;
	errors: string[];
};

/**
 * Delete multiple messages from a Telegram chat
 * Used for clearing CDN chat content
 *
 * @param botToken - Telegram bot token
 * @param chatId - Chat ID to delete messages from
 * @param messageIds - Array of message IDs to delete
 * @param delayMs - Delay between deletions to avoid rate limiting (default 100ms)
 */
export const deleteMessages = action({
	args: {
		botToken: v.string(),
		chatId: v.string(),
		messageIds: v.array(v.number()),
		delayMs: v.optional(v.number()),
	},
	returns: v.object({
		success: v.boolean(),
		deleted: v.number(),
		failed: v.number(),
		errors: v.array(v.string()),
	}),
	handler: async (
		_ctx,
		{ botToken, chatId, messageIds, delayMs = 100 },
	): Promise<DeleteMessagesResult> => {
		if (!botToken) {
			return {
				success: false,
				deleted: 0,
				failed: messageIds.length,
				errors: ["botToken is required"],
			};
		}

		const client = createTelegramClient(botToken);
		const errors: string[] = [];
		let deleted = 0;
		let failed = 0;

		for (const messageId of messageIds) {
			try {
				const response = await client.deleteMessage({
					chat_id: chatId,
					message_id: messageId,
				});

				if (isApiError(response)) {
					// Message might already be deleted or not found - not a critical error
					if (
						response.error_code === 400 &&
						response.description.includes("message to delete not found")
					) {
						// Already deleted, count as success
						deleted++;
					} else {
						failed++;
						errors.push(`Message ${messageId}: ${response.description}`);
					}
				} else {
					deleted++;
				}

				// Delay to avoid rate limiting
				if (delayMs > 0) {
					await new Promise((resolve) => setTimeout(resolve, delayMs));
				}
			} catch (error) {
				failed++;
				errors.push(
					`Message ${messageId}: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}

		return {
			success: failed === 0,
			deleted,
			failed,
			errors: errors.slice(0, 20), // Limit error array size
		};
	},
});
