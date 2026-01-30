/**
 * Admin API for managing users and settings
 * Used for development/testing - not for production use
 */
import { v } from "convex/values";
import { components } from "../_generated/api";
import { action, mutation, query } from "../_generated/server";

// Note: dateExtractor is imported dynamically in actions that need it
// to avoid Convex bundling issues with chrono-node

/**
 * Add or update a user
 */
export const upsertUser = mutation({
	args: {
		username: v.string(),
		to_be_scraped: v.optional(v.boolean()),
	},
	handler: async (ctx, { username, to_be_scraped }) => {
		return await ctx.runMutation(components.instarip.users.upsertUser, {
			username,
			to_be_scraped: to_be_scraped ?? true,
		});
	},
});

/**
 * Get current settings
 */
export const getSettings = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.runQuery(components.instarip.settings.getSettings, {});
	},
});

/**
 * Enable Instagram fetching
 */
export const enableInstagram = mutation({
	args: {},
	handler: async (ctx) => {
		return await ctx.runMutation(components.instarip.settings.upsertSettings, {
			instagram: {
				active: true,
			},
		});
	},
});

/**
 * Fetch posts for a single user (triggers Instagram fetch)
 */
export const fetchUserPosts = action({
	args: {
		username: v.string(),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, { username, limit }) => {
		// Fetch from Instagram
		const result = await ctx.runAction(components.instarip.fetcher.fetchUser, {
			username,
			limit: limit ?? 20,
		});

		if (!result.success) {
			return { success: false, error: result.error, saved: 0 };
		}

		// Get user ID (create if doesn't exist)
		let user = await ctx.runQuery(components.instarip.users.getUserByUsername, {
			username,
		});

		if (!user) {
			const userId = await ctx.runMutation(
				components.instarip.users.upsertUser,
				{
					username,
					to_be_scraped: true,
				},
			);
			user = await ctx.runQuery(components.instarip.users.getUserById, {
				id: userId,
			});
		}

		if (!user) {
			return { success: false, error: "Failed to create user", saved: 0 };
		}

		// Save each post
		let saved = 0;
		for (const post of result.posts) {
			// Check if exists
			const existing = await ctx.runQuery(
				components.instarip.posts.getPostByShortcode,
				{ shortcode: post.shortcode },
			);
			if (existing) continue;

			// Extract event date from caption
			// Uses post's Instagram timestamp as reference for relative dates
			const { getEventTimestamp } = await import("../lib/dateExtractor");
			const eventDate = getEventTimestamp(post.caption, post.timestamp);

			// Save post
			const postId = await ctx.runMutation(
				components.instarip.posts.upsertPost,
				{
					ig_id: post.id,
					shortcode: post.shortcode,
					display_url: post.display_url,
					video_url: post.video_url,
					thumbnail_url: post.thumbnail_url,
					caption: post.caption,
					is_video: post.is_video,
					url: post.url,
					media_type: post.media_type,
					timestamp: post.timestamp,
					event_date: eventDate,
					users: [user._id],
				},
			);

			// Save media items
			await ctx.runMutation(
				components.instarip.mediaItems.syncMediaItemsForPost,
				{
					post_id: postId,
					media_items: post.media_items.map((item) => ({
						url: item.url,
						type: item.type,
						width: item.width,
						height: item.height,
					})),
				},
			);

			saved++;
		}

		return { success: true, fetched: result.posts.length, saved };
	},
});

// Backfill functions moved to api/backfill.ts
