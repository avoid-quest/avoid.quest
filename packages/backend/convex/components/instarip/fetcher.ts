/**
 * Instagram fetching actions
 * These actions handle the Instagram API calls - database access is done by the main app
 */

import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import {
	type FetchedPost,
	fetchedPostValidator,
	fetchSinglePost,
	fetchUserPosts,
} from "./adapter";

const DEFAULT_LOG_RETENTION_DAYS = 30;
const CLEANUP_BATCH_SIZE = 100;

export type FetchUserResult = {
	success: boolean;
	posts: FetchedPost[];
	error?: string;
};

/**
 * Fetch posts for a single Instagram user
 * Returns raw post data - the main app is responsible for saving to database
 */
export const fetchUser = action({
	args: {
		username: v.string(),
		limit: v.optional(v.number()),
	},
	returns: v.object({
		success: v.boolean(),
		posts: v.array(fetchedPostValidator),
		error: v.optional(v.string()),
	}),
	handler: async (_ctx, { username, limit }): Promise<FetchUserResult> => {
		const result = await fetchUserPosts(username, limit ?? 20);
		return {
			success: result.success,
			posts: result.posts,
			error: result.error,
		};
	},
});

/**
 * Fetch a single post by URL
 * Uses oEmbed API as a fallback when full API fails
 */
export const fetchPost = action({
	args: {
		postUrl: v.string(),
	},
	returns: v.object({
		success: v.boolean(),
		post: v.optional(fetchedPostValidator),
		error: v.optional(v.string()),
	}),
	handler: async (_ctx, { postUrl }) => {
		const result = await fetchSinglePost(postUrl);

		if (!result.success || result.posts.length === 0) {
			return {
				success: false,
				error: result.error ?? "Failed to fetch post",
			};
		}

		return {
			success: true,
			post: result.posts[0],
		};
	},
});

/**
 * Test Instagram API connectivity
 * Attempts to fetch a well-known public profile
 */
export const testConnectivity = action({
	args: {},
	returns: v.object({
		success: v.boolean(),
		message: v.string(),
	}),
	handler: async () => {
		// Try to fetch a public profile (Instagram's own account)
		const result = await fetchUserPosts("instagram", 1);

		if (result.success) {
			return {
				success: true,
				message: `Connected successfully. Found ${result.posts.length} post(s).`,
			};
		}

		return {
			success: false,
			message: result.error ?? "Failed to connect to Instagram API",
		};
	},
});

/**
 * Log a fetch operation to the database
 */
export const logFetch = mutation({
	args: {
		username: v.string(),
		posts_fetched: v.number(),
		success: v.boolean(),
		error: v.optional(v.string()),
	},
	handler: async (ctx, { username, posts_fetched, success, error }) => {
		return await ctx.db.insert("fetch_logs", {
			username,
			fetched_at: Date.now(),
			posts_fetched,
			success,
			error,
		});
	},
});

/**
 * Get recent fetch logs
 */
export const getFetchLogs = query({
	args: {
		limit: v.optional(v.number()),
	},
	handler: async (ctx, { limit }) => {
		return await ctx.db
			.query("fetch_logs")
			.withIndex("by_fetched_at")
			.order("desc")
			.take(limit ?? 50);
	},
});

/**
 * Get fetch logs for a specific user
 */
export const getFetchLogsByUsername = query({
	args: {
		username: v.string(),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, { username, limit }) => {
		return await ctx.db
			.query("fetch_logs")
			.withIndex("by_username", (q) => q.eq("username", username))
			.order("desc")
			.take(limit ?? 20);
	},
});

/**
 * Cleanup old fetch logs based on retention settings.
 * Deletes logs older than max_retention_days (default: 30 days).
 * Uses batching to avoid memory issues with large datasets.
 *
 * Note: This is a public mutation so it can be called from cron jobs
 * in the main app. Consider access control if needed.
 */
export const cleanupOldLogs = mutation({
	args: {},
	returns: v.number(),
	handler: async (ctx) => {
		// Get logging settings for retention days
		const settings = await ctx.db.query("settings").first();
		const retentionDays =
			settings?.logging?.max_retention_days ?? DEFAULT_LOG_RETENTION_DAYS;

		// Calculate cutoff timestamp
		const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

		// Query logs older than cutoff in batches to avoid OOM
		const oldLogs = await ctx.db
			.query("fetch_logs")
			.withIndex("by_fetched_at", (q) => q.lt("fetched_at", cutoffMs))
			.take(CLEANUP_BATCH_SIZE);

		// Delete old logs
		for (const log of oldLogs) {
			await ctx.db.delete(log._id);
		}

		return oldLogs.length;
	},
});
