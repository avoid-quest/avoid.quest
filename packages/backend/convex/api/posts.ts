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

/**
 * Location data from Instagram
 */
type Location = {
	ig_id: string;
	name: string;
	slug: string;
};

/**
 * Full post type matching the component schema
 */
type Post = {
	_id: string;
	_creationTime: number;
	ig_id: string;
	shortcode: string;
	display_url: string;
	video_url?: string;
	thumbnail_url?: string;
	caption: string;
	is_video: boolean;
	url: string;
	media_type: "image" | "video" | "carousel";
	users: string[];
	timestamp: number;
	event_date?: number;
	/** Instagram location data */
	location?: Location;
	/** Collaborator usernames */
	collaborators?: string[];
	status: "pending" | "sending" | "sent" | "failed";
	sentAt?: number;
	retry_count?: number;
};

/**
 * Post enriched with proxy media IDs for the frontend
 */
export type EnrichedPost = Post & {
	proxyImageId?: string;
	proxyVideoId?: string;
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
async function enrichPostWithMedia(
	ctx: QueryCtx,
	post: Post,
): Promise<EnrichedPost> {
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
async function enrichPostsWithMedia(
	ctx: QueryCtx,
	posts: Post[],
): Promise<EnrichedPost[]> {
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
		return enrichPostsWithMedia(ctx, posts as Post[]);
	},
});

/**
 * Get paginated posts ordered by event date
 * Uses convex-helpers paginator (works in components)
 * Accepts paginationOpts wrapper from usePaginatedQuery hook
 * Enriches posts with proxy media IDs when available
 *
 * NOTE: continueCursor returns empty string ("") instead of null
 * to match convex-helpers usePaginatedQuery expectations.
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
			isDone: result.isDone,
			// Convert null to empty string for convex-helpers compatibility
			continueCursor: result.continueCursor ?? "",
			page: await enrichPostsWithMedia(ctx, result.page as Post[]),
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
		return enrichPostWithMedia(ctx, post as Post);
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
		return enrichPostWithMedia(ctx, post as Post);
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
		return enrichPostsWithMedia(ctx, posts as Post[]);
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
		return enrichPostsWithMedia(ctx, posts as Post[]);
	},
});

/**
 * Get filtered posts (non-paginated, returns up to limit)
 */
export const getFiltered = query({
	args: {
		limit: v.optional(v.number()),
		userId: v.optional(v.string()),
		startDate: v.optional(v.number()),
		endDate: v.optional(v.number()),
		locationId: v.optional(v.string()),
		collaborator: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ limit, userId, startDate, endDate, locationId, collaborator },
	) => {
		const posts = await ctx.runQuery(
			components.instarip.posts.getPostsWithFilters,
			{
				limit,
				// biome-ignore lint/suspicious/noExplicitAny: Cross-component Id type
				userId: userId as any,
				startDate,
				endDate,
				locationId,
				collaborator,
			},
		);
		return enrichPostsWithMedia(ctx, posts as Post[]);
	},
});

/**
 * Get all unique locations (for filter dropdown)
 */
export const getLocations = query({
	handler: async (ctx) => {
		return await ctx.runQuery(components.instarip.posts.getLocations, {});
	},
});

/**
 * Get all unique collaborators (for filter dropdown)
 */
export const getCollaborators = query({
	handler: async (ctx) => {
		return await ctx.runQuery(components.instarip.posts.getCollaborators, {});
	},
});

/**
 * Get posts by user ID
 */
export const getByUserId = query({
	args: {
		userId: v.string(),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, { userId, limit }) => {
		const posts = await ctx.runQuery(
			components.instarip.posts.getPostsByUserId,
			// biome-ignore lint/suspicious/noExplicitAny: Cross-component Id type
			{ userId: userId as any },
		);
		const limited = posts.slice(0, limit ?? 50);
		return enrichPostsWithMedia(ctx, limited as Post[]);
	},
});
