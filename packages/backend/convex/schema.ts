import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Database schema for the backend
 *
 * IMPORTANT: All timestamp fields (timestamp, event_date, sentAt, *_at, etc.)
 * are stored in MILLISECONDS (JavaScript standard, UTC).
 * Timestamps are timezone-agnostic (stored in UTC) and converted to
 * Europe/Rome timezone for display purposes.
 */
export default defineSchema({
	posts: defineTable({
		ig_id: v.string(),
		shortcode: v.string(),
		display_url: v.string(),
		video_url: v.optional(v.string()),
		thumbnail_url: v.optional(v.string()),
		caption: v.string(),
		is_video: v.boolean(),
		url: v.string(),
		media_type: v.union(
			v.literal("image"),
			v.literal("video"),
			v.literal("carousel"),
		),
		/** Timestamp in milliseconds (UTC) - when the post was published on Instagram */
		timestamp: v.number(),
		/** Event date in milliseconds (UTC) - when the event occurs (if applicable) */
		event_date: v.optional(v.number()),
		users: v.array(v.id("users")),
		sent: v.boolean(),
		/** Timestamp in milliseconds (UTC) - when the post was sent to Telegram */
		sentAt: v.optional(v.number()),
	})
		.index("by_timestamp", ["timestamp"])
		.index("by_event_date", ["event_date"])
		.index("by_shortcode", ["shortcode"])
		.index("by_user_id", ["users"])
		.index("by_sent", ["sent"]),
	media_items: defineTable({
		// Instagram URL (temporary - will be removed after migration)
		url: v.optional(v.string()),
		// Telegram file_id (permanent) - added during migration
		file_id: v.optional(v.string()),
		// Telegram file_unique_id (for deduplication) - added during migration
		file_unique_id: v.optional(v.string()),
		type: v.union(
			v.literal("image"),
			v.literal("video"),
			v.literal("thumbnail"),
		),
		width: v.optional(v.number()),
		height: v.optional(v.number()),
		post_id: v.id("posts"),
	})
		.index("by_url", ["url"])
		.index("by_file_id", ["file_id"])
		.index("by_file_unique_id", ["file_unique_id"])
		.index("by_type", ["type"])
		.index("by_post_id", ["post_id"]),
	users: defineTable({
		username: v.string(),
		profile_url: v.optional(v.string()),
		to_be_scraped: v.boolean(),
		/** Timestamp in milliseconds (UTC) - when the user was last scraped */
		last_scraped_at: v.optional(v.number()),
	})
		.index("by_username", ["username"])
		.index("by_to_be_scraped_last_scraped_at", [
			"to_be_scraped",
			"last_scraped_at",
		]),
	telegram_messages: defineTable({
		post_id: v.id("posts"),
		/** Telegram message ID */
		message_id: v.number(),
		/** Telegram chat ID */
		chat_id: v.string(),
		/** Timestamp in milliseconds (UTC) - when the message was sent */
		sentAt: v.number(),
	})
		.index("by_post_id", ["post_id"])
		.index("by_message_id_chat_id", ["message_id", "chat_id"]),
	settings: defineTable({
		telegram: v.optional(
			v.object({
				active: v.boolean(),
				admin_chat_id: v.optional(v.string()),
				group_chat_id: v.optional(v.string()),
				cron_expression: v.optional(v.string()),
				send_limit: v.optional(v.number()),
				/** Timestamp in milliseconds (UTC) - when posts were last sent to Telegram */
				last_sent_at: v.optional(v.number()),
				send_report: v.boolean(),
				report_cron_expression: v.optional(v.string()),
			}),
		),
		instagram: v.optional(
			v.object({
				active: v.boolean(),
				cron_expression: v.optional(v.string()),
				limit: v.optional(v.number()),
				post_per_user: v.optional(v.number()),
				/** Timestamp in milliseconds (UTC) - when fetching last ran */
				last_scraped_at: v.optional(v.number()),
			}),
		),
		/** @deprecated Use instagram instead - kept for backwards compatibility */
		scraper: v.optional(
			v.object({
				active: v.boolean(),
				cron_expression: v.optional(v.string()),
				limit: v.optional(v.number()),
				post_per_user: v.optional(v.number()),
				last_scraped_at: v.optional(v.number()),
			}),
		),
		logging: v.optional(
			v.object({
				active: v.boolean(),
				/** Timestamp in milliseconds (UTC) - when logging last ran */
				last_logged_at: v.optional(v.number()),
				max_retention_days: v.optional(v.number()),
				log_file: v.optional(v.string()),
				log_level: v.optional(v.string()),
			}),
		),
	}),
});
