import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Main app schema - shared tables only
 *
 * All Instarip-specific tables (posts, users, media_items, settings, telegram_messages, fetch_logs)
 * are now in the instarip component namespace.
 *
 * This schema contains only shared tables used across the application.
 */
export default defineSchema({
	bot_sessions: defineTable({
		/** Chat ID as string (session key) */
		key: v.string(),
		/** JSON-serialized session data */
		data: v.string(),
	}).index("by_key", ["key"]),
});
