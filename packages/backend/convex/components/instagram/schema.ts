import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Instagram component schema
 * Tables are isolated within the component namespace
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

	rate_limits: defineTable({
		/** Token bucket identifier */
		bucket_id: v.string(),
		/** Current number of tokens */
		tokens: v.number(),
		/** Last refill timestamp in milliseconds (UTC) */
		last_refill_at: v.number(),
		/** Maximum tokens (burst capacity) */
		max_tokens: v.number(),
		/** Tokens added per second */
		refill_rate: v.number(),
	}).index("by_bucket_id", ["bucket_id"]),
});
