import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Settings validators for the instarip component
 * These are the canonical validators for component isolation
 */
const telegramSettingsValidator = v.object({
	active: v.boolean(),
	group_chat_id: v.optional(v.string()),
	send_limit: v.optional(v.number()),
	send_report: v.boolean(),
	request_timeout_ms: v.optional(v.number()),
	delay_between_posts_ms: v.optional(v.number()),
});

const instagramSettingsValidator = v.object({
	active: v.boolean(),
	limit: v.optional(v.number()),
	post_per_user: v.optional(v.number()),
	request_timeout_ms: v.optional(v.number()),
	min_scrape_interval_ms: v.optional(v.number()),
	delay_between_users_min_ms: v.optional(v.number()),
	delay_between_users_max_ms: v.optional(v.number()),
	rate_limit_max_tokens: v.optional(v.number()),
	rate_limit_refill_rate: v.optional(v.number()),
});

const localeSettingsValidator = v.object({
	timezone: v.optional(v.string()),
	locale: v.optional(v.string()),
});

const loggingSettingsValidator = v.object({
	active: v.boolean(),
	max_retention_days: v.optional(v.number()),
	log_file: v.optional(v.string()),
	log_level: v.optional(v.string()),
});

/**
 * Instarip component schema
 * All Instarip data tables are isolated within this component namespace
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
		/** Whether this post is currently being sent (prevents concurrent sends) */
		sending: v.optional(v.boolean()),
		/** Number of retry attempts for failed sends */
		retry_count: v.optional(v.number()),
		/** Whether this post has permanently failed to send */
		send_failed: v.optional(v.boolean()),
	})
		.index("by_timestamp", ["timestamp"])
		.index("by_event_date", ["event_date"])
		.index("by_shortcode", ["shortcode"])
		.index("by_user_id", ["users"])
		.index("by_sent", ["sent"]),

	media_items: defineTable({
		// Telegram file_id (permanent)
		file_id: v.optional(v.string()),
		// Telegram file_unique_id (for deduplication)
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
		telegram: v.optional(telegramSettingsValidator),
		instagram: v.optional(instagramSettingsValidator),
		locale: v.optional(localeSettingsValidator),
		logging: v.optional(loggingSettingsValidator),
	}),

	fetch_logs: defineTable({
		username: v.string(),
		/** Timestamp in milliseconds (UTC) - when the fetch occurred */
		fetched_at: v.number(),
		posts_fetched: v.number(),
		success: v.boolean(),
		error: v.optional(v.string()),
	})
		.index("by_username", ["username"])
		.index("by_fetched_at", ["fetched_at"]),
});

// Export validators for use in other files within this component
export {
	telegramSettingsValidator,
	instagramSettingsValidator,
	localeSettingsValidator,
	loggingSettingsValidator,
};
