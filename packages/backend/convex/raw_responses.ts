/**
 * Raw Instagram API response storage for debugging and testing
 *
 * This module provides functionality to store and query raw API responses
 * from Instagram. Useful for:
 * - Debugging different media types (carousel, video, image)
 * - Testing parsing logic against real API responses
 * - Analyzing API response structure changes
 */

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

const responseTypeValidator = v.union(
	v.literal("user_posts"),
	v.literal("single_post"),
	v.literal("oembed"),
);

/**
 * Query raw response by shortcode
 */
export const getRawResponseByShortcode = query({
	args: { shortcode: v.string() },
	handler: async (ctx, { shortcode }) => {
		return await ctx.db
			.query("raw_instagram_responses")
			.withIndex("by_shortcode", (q) => q.eq("shortcode", shortcode))
			.first();
	},
});

/**
 * Query all raw responses for a username
 */
export const getRawResponsesByUsername = query({
	args: { username: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, { username, limit = 10 }) => {
		return await ctx.db
			.query("raw_instagram_responses")
			.withIndex("by_username", (q) => q.eq("username", username))
			.take(limit);
	},
});

/**
 * Query recent raw responses (for debugging)
 */
export const getRecentRawResponses = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit = 10 }) => {
		return await ctx.db
			.query("raw_instagram_responses")
			.withIndex("by_fetched_at")
			.order("desc")
			.take(limit);
	},
});

/**
 * Store a raw response (public mutation for manual storage)
 */
export const storeRawResponse = mutation({
	args: {
		shortcode: v.string(),
		username: v.string(),
		raw_response: v.string(),
		response_type: responseTypeValidator,
	},
	handler: async (
		ctx,
		{ shortcode, username, raw_response, response_type },
	) => {
		// Check if we already have a response for this shortcode
		const existing = await ctx.db
			.query("raw_instagram_responses")
			.withIndex("by_shortcode", (q) => q.eq("shortcode", shortcode))
			.first();

		if (existing) {
			// Update existing
			await ctx.db.patch(existing._id, {
				raw_response,
				fetched_at: Date.now(),
				response_type,
			});
			return existing._id;
		}

		// Insert new
		return await ctx.db.insert("raw_instagram_responses", {
			shortcode,
			username,
			raw_response,
			fetched_at: Date.now(),
			response_type,
		});
	},
});

/**
 * Store a raw response (internal mutation for use from fetcher)
 */
export const storeRawResponseInternal = internalMutation({
	args: {
		shortcode: v.string(),
		username: v.string(),
		raw_response: v.string(),
		response_type: responseTypeValidator,
	},
	handler: async (
		ctx,
		{ shortcode, username, raw_response, response_type },
	) => {
		// Check if we already have a response for this shortcode
		const existing = await ctx.db
			.query("raw_instagram_responses")
			.withIndex("by_shortcode", (q) => q.eq("shortcode", shortcode))
			.first();

		if (existing) {
			// Update existing
			await ctx.db.patch(existing._id, {
				raw_response,
				fetched_at: Date.now(),
				response_type,
			});
			return existing._id;
		}

		// Insert new
		return await ctx.db.insert("raw_instagram_responses", {
			shortcode,
			username,
			raw_response,
			fetched_at: Date.now(),
			response_type,
		});
	},
});

/**
 * Delete a raw response by shortcode
 */
export const deleteRawResponse = mutation({
	args: { shortcode: v.string() },
	handler: async (ctx, { shortcode }) => {
		const existing = await ctx.db
			.query("raw_instagram_responses")
			.withIndex("by_shortcode", (q) => q.eq("shortcode", shortcode))
			.first();

		if (existing) {
			await ctx.db.delete(existing._id);
			return true;
		}
		return false;
	},
});

/**
 * Cleanup old responses (older than specified days)
 * Can be called from a cron job for maintenance
 */
export const cleanupOldResponses = internalMutation({
	args: { maxAgeDays: v.optional(v.number()) },
	handler: async (ctx, { maxAgeDays = 30 }) => {
		const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

		const oldResponses = await ctx.db
			.query("raw_instagram_responses")
			.withIndex("by_fetched_at")
			.filter((q) => q.lt(q.field("fetched_at"), cutoffTime))
			.collect();

		let deletedCount = 0;
		for (const response of oldResponses) {
			await ctx.db.delete(response._id);
			deletedCount++;
		}

		return { deletedCount };
	},
});
