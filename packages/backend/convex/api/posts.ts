/**
 * Public API for posts - used by instarip web frontend
 * Wraps the internal component functions for public access
 */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { query } from "../_generated/server";

/**
 * Get paginated posts ordered by event date
 */
export const getPaginated = query({
	args: { paginationOpts: paginationOptsValidator },
	handler: async (ctx, { paginationOpts }) => {
		return await ctx.runQuery(components.instarip.posts.getPostsPaginated, {
			paginationOpts,
		});
	},
});

/**
 * Get a single post by shortcode
 */
export const getByShortcode = query({
	args: { shortcode: v.string() },
	handler: async (ctx, { shortcode }) => {
		return await ctx.runQuery(components.instarip.posts.getPostByShortcode, {
			shortcode,
		});
	},
});

/**
 * Get a single post by ID
 */
export const getById = query({
	args: { id: v.id("posts") },
	handler: async (ctx, { id }) => {
		// Note: Component uses its own Id type, but we accept the main app's Id
		// The underlying document ID is the same
		// biome-ignore lint/suspicious/noExplicitAny: Cross-component Id type casting
		return await ctx.runQuery(components.instarip.posts.getPostById, {
			id: id as any,
		});
	},
});

/**
 * Get recent posts (simple query with limit)
 */
export const getRecent = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) => {
		return await ctx.runQuery(components.instarip.posts.getPosts, {
			limit: limit ?? 20,
		});
	},
});
