/**
 * Public API for posts - used by instarip web frontend
 * Wraps the internal component functions for public access
 *
 * NOTE: Uses convex-helpers paginator for pagination in components.
 */
import { v } from "convex/values";
import { components } from "../_generated/api";
import { query } from "../_generated/server";

/**
 * Get posts ordered by event date (with limit, no pagination)
 */
export const getPosts = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) => {
		return await ctx.runQuery(components.instarip.posts.getPosts, {
			limit: limit ?? 50,
		});
	},
});

/**
 * Get paginated posts ordered by event date
 * Uses convex-helpers paginator (works in components)
 * Accepts paginationOpts wrapper from usePaginatedQuery hook
 */
export const getPaginated = query({
	args: {
		paginationOpts: v.object({
			cursor: v.union(v.string(), v.null()),
			numItems: v.number(),
			endCursor: v.optional(v.union(v.string(), v.null())),
		}),
	},
	handler: async (ctx, { paginationOpts }) => {
		return await ctx.runQuery(components.instarip.posts.getPostsPaginated, {
			cursor: paginationOpts.cursor,
			numItems: paginationOpts.numItems,
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
 * Note: Component uses its own Id type, but we accept the main app's Id
 */
export const getById = query({
	args: { id: v.id("posts") },
	handler: async (ctx, { id }) => {
		return await ctx.runQuery(components.instarip.posts.getPostById, {
			// biome-ignore lint/suspicious/noExplicitAny: Cross-component Id type
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

/**
 * Search posts by caption text (full-text search)
 */
export const search = query({
	args: {
		query: v.string(),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, { query: searchQuery, limit }) => {
		return await ctx.runQuery(components.instarip.posts.searchPosts, {
			query: searchQuery,
			limit,
		});
	},
});

/**
 * Get filtered posts (non-paginated, returns up to limit)
 */
export const getFiltered = query({
	args: {
		limit: v.optional(v.number()),
		userId: v.optional(v.id("users")),
		startDate: v.optional(v.number()),
		endDate: v.optional(v.number()),
	},
	handler: async (ctx, { limit, userId, startDate, endDate }) => {
		return await ctx.runQuery(components.instarip.posts.getPostsWithFilters, {
			limit,
			// biome-ignore lint/suspicious/noExplicitAny: Cross-component Id type
			userId: userId as any,
			startDate,
			endDate,
		});
	},
});
