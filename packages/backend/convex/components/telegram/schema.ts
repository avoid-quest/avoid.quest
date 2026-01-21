import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Telegram component schema
 * Tables are isolated within the component namespace
 */
export default defineSchema({
	bot_sessions: defineTable({
		/** Telegram chat ID */
		chat_id: v.string(),
		/** Current menu state for navigation */
		menu_state: v.optional(v.string()),
		/** Pagination offset for list views */
		pagination_offset: v.optional(v.number()),
		/** Timestamp in milliseconds (UTC) - last interaction */
		last_interaction_at: v.number(),
		/** Additional session data */
		data: v.optional(v.any()),
	}).index("by_chat_id", ["chat_id"]),

	sent_messages_log: defineTable({
		/** Telegram message ID */
		message_id: v.number(),
		/** Telegram chat ID */
		chat_id: v.string(),
		/** Type of message sent */
		message_type: v.union(
			v.literal("post"),
			v.literal("report"),
			v.literal("command_response"),
		),
		/** Timestamp in milliseconds (UTC) - when sent */
		sent_at: v.number(),
		/** Whether the send was successful */
		success: v.boolean(),
		/** Error message if failed */
		error: v.optional(v.string()),
	})
		.index("by_chat_id", ["chat_id"])
		.index("by_sent_at", ["sent_at"]),
});
