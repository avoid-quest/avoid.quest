/**
 * Public API for posts - used by instarip web frontend
 * Wraps the internal component functions for public access
 *
 * NOTE: Uses convex-helpers paginator for pagination in components.
 */
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";

type Post = {
	_id: string;
	[key: string]: unknown;
};

type MediaItem = {
	_id: string;
	type: "image" | "video" | "thumbnail";
	telegram_file?: { file_id: string; file_unique_id: string };
};

/**
 * Enrich a post with proxy media IDs
 * Always returns media IDs if available - the HTTP handler will
 * redirect to Instagram URLs as fallback if not yet on Telegram
 */
async function enrichPostWithMedia(ctx: QueryCtx, post: Post) {
	const mediaItems: MediaItem[] = await ctx.runQuery(
		components.instarip.mediaItems.getMediaItemsByPostId,
		// biome-ignore lint/suspicious/noExplicitAny: Cross-component Id type
		{ postId: post._id as any },
	);

	// Find first image and video items (regardless of telegram_file status)
	const imageItem = mediaItems.find((item: MediaItem) => item.type === "image");
	const videoItem = mediaItems.find((item: MediaItem) => item.type === "video");

	return {
		...post,
		proxyImageId: imageItem?._id,
		proxyVideoId: videoItem?._id,
	};
}

/**
 * Enrich multiple posts with proxy media IDs
 */
async function enrichPostsWithMedia(ctx: QueryCtx, posts: Post[]) {
	return Promise.all(posts.map((post) => enrichPostWithMedia(ctx, post)));
}

/**
 * Get posts ordered by event date (with limit, no pagination)
 */
export const getPosts = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) => {
		const posts = await ctx.runQuery(components.instarip.posts.getPosts, {
			limit: limit ?? 50,
		});
		return enrichPostsWithMedia(ctx, posts);
	},
});

/**
 * Get paginated posts ordered by event date
 * Uses convex-helpers paginator (works in components)
 * Accepts paginationOpts wrapper from usePaginatedQuery hook
 * Enriches posts with proxy media IDs when available
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
		const result = await ctx.runQuery(
			components.instarip.posts.getPostsPaginated,
			{
				cursor: paginationOpts.cursor,
				numItems: paginationOpts.numItems,
			},
		);

		return {
			...result,
			page: await enrichPostsWithMedia(ctx, result.page),
		};
	},
});

/**
 * Get a single post by shortcode
 */
export const getByShortcode = query({
	args: { shortcode: v.string() },
	handler: async (ctx, { shortcode }) => {
		const post = await ctx.runQuery(
			components.instarip.posts.getPostByShortcode,
			{ shortcode },
		);
		if (!post) return null;
		return enrichPostWithMedia(ctx, post);
	},
});

/**
 * Get a single post by ID
 * Note: Component uses its own Id type, but we accept the main app's Id
 */
export const getById = query({
	args: { id: v.id("posts") },
	handler: async (ctx, { id }) => {
		const post = await ctx.runQuery(components.instarip.posts.getPostById, {
			// biome-ignore lint/suspicious/noExplicitAny: Cross-component Id type
			id: id as any,
		});
		if (!post) return null;
		return enrichPostWithMedia(ctx, post);
	},
});

/**
 * Get recent posts (simple query with limit)
 */
export const getRecent = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) => {
		const posts = await ctx.runQuery(components.instarip.posts.getPosts, {
			limit: limit ?? 20,
		});
		return enrichPostsWithMedia(ctx, posts);
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
		const posts = await ctx.runQuery(components.instarip.posts.searchPosts, {
			query: searchQuery,
			limit,
		});
		return enrichPostsWithMedia(ctx, posts);
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
		const posts = await ctx.runQuery(
			components.instarip.posts.getPostsWithFilters,
			{
				limit,
				// biome-ignore lint/suspicious/noExplicitAny: Cross-component Id type
				userId: userId as any,
				startDate,
				endDate,
			},
		);
		return enrichPostsWithMedia(ctx, posts);
	},
});

/**
 * Get posts by user ID
 */
export const getByUserId = query({
	args: {
		userId: v.id("users"),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, { userId, limit }) => {
		const posts = await ctx.runQuery(
			components.instarip.posts.getPostsByUserId,
			// biome-ignore lint/suspicious/noExplicitAny: Cross-component Id type
			{ userId: userId as any },
		);
		const limited = posts.slice(0, limit ?? 50);
		return enrichPostsWithMedia(ctx, limited);
	},
});
