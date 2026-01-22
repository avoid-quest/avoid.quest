import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Instagram component schema
 * Tables are isolated within the component namespace
 *
 * Note: Rate limiting is handled in-memory within actions (see lib/rateLimiter.ts).
 * For persistent rate limiting, consider using @convex-dev/rate-limiter.
 */
export default defineSchema({
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
