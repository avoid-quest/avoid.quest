import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { secondsToMilliseconds } from "./lib/dateUtils";

export const getPosts = query({
	args: { limit: v.number() },
	handler: async (ctx, { limit }) =>
		await ctx.db
			.query("posts")
			.withIndex("by_event_date")
			.order("desc")
			.take(limit ?? 10),
});

/**
 * Shared validator for paginated post results
 */
const paginatedPostValidator = v.object({
	_id: v.id("posts"),
	_creationTime: v.number(),
	ig_id: v.string(),
	shortcode: v.string(),
	display_url: v.string(),
	video_url: v.optional(v.string()),
	thumbnail_url: v.optional(v.string()),
	caption: v.string(),
	is_video: v.boolean(),
	url: v.string(),
	media_type: v.union(
		v.literal("image"),
		v.literal("video"),
		v.literal("carousel"),
	),
	users: v.array(v.id("users")),
	timestamp: v.number(),
	event_date: v.optional(v.number()),
	sent: v.optional(v.boolean()),
	sentAt: v.optional(v.number()),
});

export const getPostById = query({
	args: { id: v.id("posts") },
	handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const getPostsByUserId = query({
	args: { userId: v.id("users") },
	handler: async (ctx, { userId }) =>
		await ctx.db
			.query("posts")
			.withIndex("by_user_id", (q) => q.eq("users", [userId]))
			.collect(),
});

export const getPostByShortcode = query({
	args: { shortcode: v.string() },
	handler: async (ctx, { shortcode }) =>
		await ctx.db
			.query("posts")
			.withIndex("by_shortcode", (q) => q.eq("shortcode", shortcode))
			.first(),
});

export const getUnsent = query({
	args: { limit: v.number() },
	handler: async (ctx, { limit }) =>
		await ctx.db
			.query("posts")
			.withIndex("by_sent", (q) => q.eq("sent", false))
			.take(limit),
});

export const getPostsPaginated = query({
	args: { paginationOpts: paginationOptsValidator },
	returns: v.object({
		page: v.array(paginatedPostValidator),
		isDone: v.boolean(),
		continueCursor: v.union(v.string(), v.null()),
	}),
	handler: async (ctx, { paginationOpts }) => {
		const result = await ctx.db
			.query("posts")
			.withIndex("by_event_date")
			.order("desc")
			.paginate(paginationOpts);
		return {
			page: result.page,
			isDone: result.isDone,
			continueCursor: result.continueCursor,
		};
	},
});

export const getUnsentPaginated = query({
	args: { paginationOpts: paginationOptsValidator },
	returns: v.object({
		page: v.array(paginatedPostValidator),
		isDone: v.boolean(),
		continueCursor: v.union(v.string(), v.null()),
	}),
	handler: async (ctx, { paginationOpts }) => {
		const result = await ctx.db
			.query("posts")
			.withIndex("by_sent", (q) => q.eq("sent", false))
			.order("desc")
			.paginate(paginationOpts);
		return {
			page: result.page,
			isDone: result.isDone,
			continueCursor: result.continueCursor,
		};
	},
});

export const upsertPost = mutation({
	args: {
		id: v.optional(v.id("posts")),
		ig_id: v.string(),
		shortcode: v.string(),
		display_url: v.string(),
		video_url: v.optional(v.string()),
		thumbnail_url: v.optional(v.string()),
		caption: v.string(),
		is_video: v.boolean(),
		url: v.string(),
		media_type: v.union(
			v.literal("image"),
			v.literal("video"),
			v.literal("carousel"),
		),
		users: v.array(v.id("users")),
		timestamp: v.number(),
		event_date: v.optional(v.number()),
		sent: v.optional(v.boolean()),
		sentAt: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{
			id,
			ig_id,
			shortcode,
			display_url,
			video_url,
			thumbnail_url,
			caption,
			is_video,
			url,
			media_type,
			users,
			timestamp,
			event_date,
			sent,
			sentAt,
		},
	) => {
		// Convert timestamp from seconds (Instagram API format) to milliseconds (internal standard)
		// The adapter sends timestamps in seconds, but we store them in milliseconds
		const timestampMs = secondsToMilliseconds(timestamp);
		const eventDateMs = event_date
			? secondsToMilliseconds(event_date)
			: undefined;
		const sentAtMs = sentAt ? secondsToMilliseconds(sentAt) : undefined;

		if (id) {
			// Update existing post - preserve sent, sentAt, and event_date if not provided
			const existing = await ctx.db.get(id);
			if (!existing) {
				throw new Error(`Post with id ${id} not found`);
			}

			// Merge users arrays - add new users if they don't already exist
			const existingUsers = existing.users ?? [];
			const mergedUsers = [...new Set([...existingUsers, ...users])];

			// Only update sent/sentAt/event_date if explicitly provided (not undefined)
			const patchData: {
				ig_id: string;
				shortcode: string;
				display_url: string;
				video_url?: string;
				thumbnail_url?: string;
				caption: string;
				is_video: boolean;
				url: string;
				media_type: "image" | "video" | "carousel";
				users: Array<Id<"users">>;
				timestamp: number;
				event_date?: number;
				sent?: boolean;
				sentAt?: number;
			} = {
				ig_id,
				shortcode,
				display_url,
				video_url,
				thumbnail_url,
				caption,
				is_video,
				url,
				media_type,
				users: mergedUsers,
				timestamp: timestampMs,
			};

			// Only patch optional fields if they are explicitly provided
			if (event_date !== undefined) {
				patchData.event_date = eventDateMs;
			}
			if (sent !== undefined) {
				patchData.sent = sent;
			}
			if (sentAt !== undefined) {
				patchData.sentAt = sentAtMs;
			}

			await ctx.db.patch(id, patchData);
			return id;
		}
		return await ctx.db.insert("posts", {
			ig_id,
			shortcode,
			display_url,
			video_url,
			thumbnail_url,
			caption,
			is_video,
			url,
			media_type,
			users,
			timestamp: timestampMs,
			event_date: eventDateMs,
			sent: sent ?? false,
			sentAt: sentAtMs,
		});
	},
});

export const deletePost = mutation({
	args: { id: v.id("posts") },
	handler: async (ctx, { id }) => await ctx.db.delete(id),
});

/**
 * Mark a post as sent to Telegram.
 *
 * @param id - The post ID to mark as sent
 * @param sentAt - Timestamp in MILLISECONDS (use Date.now())
 *
 * NOTE: Unlike upsertPost which expects seconds from Instagram API,
 * this function expects milliseconds directly (Date.now() format).
 */
export const markSent = mutation({
	args: { id: v.id("posts"), sentAt: v.number() },
	handler: async (ctx, { id, sentAt }) => {
		// Validate post exists
		const post = await ctx.db.get(id);
		if (!post) {
			throw new Error(`Post ${id} not found`);
		}

		// sentAt is already in milliseconds (Date.now() returns milliseconds)
		// Store directly without conversion
		await ctx.db.patch(id, { sent: true, sentAt });
		return null;
	},
});

/**
 * Get statistics for backfill progress.
 * Returns counts of posts with and without file_ids in their media items.
 *
 * Optimized to avoid N+1 queries by fetching all media items in one query
 * and grouping them by post_id.
 */
export const getBackfillStats = query({
	handler: async (ctx) => {
		// Get all sent posts
		const sentPosts = await ctx.db
			.query("posts")
			.withIndex("by_sent", (q) => q.eq("sent", true))
			.collect();

		if (sentPosts.length === 0) {
			return { totalSent: 0, withFileIds: 0, needsBackfill: 0 };
		}

		// Create a Set of sent post IDs for fast lookup
		const sentPostIds = new Set(sentPosts.map((p) => p._id));

		// Get all media items in one query and group by post_id
		const allMediaItems = await ctx.db.query("media_items").collect();

		// Group media items by post_id and track file_id status
		const mediaByPost = new Map<
			Id<"posts">,
			{ total: number; withFileId: number }
		>();

		for (const item of allMediaItems) {
			// Only process media items for sent posts
			if (!sentPostIds.has(item.post_id)) {
				continue;
			}

			const current = mediaByPost.get(item.post_id) ?? {
				total: 0,
				withFileId: 0,
			};
			current.total++;
			if (item.file_id) {
				current.withFileId++;
			}
			mediaByPost.set(item.post_id, current);
		}

		// Count posts by their media status
		let withFileIds = 0;
		let needsBackfill = 0;

		for (const post of sentPosts) {
			const media = mediaByPost.get(post._id);
			if (!media || media.total === 0) {
				// Post has no media items - not counted as needing backfill
				continue;
			}
			if (media.withFileId === media.total) {
				withFileIds++;
			} else {
				needsBackfill++;
			}
		}

		return {
			totalSent: sentPosts.length,
			withFileIds,
			needsBackfill,
		};
	},
});

/**
 * Internal query to get unsent posts for the Telegram cron
 */
export const getUnsentInternal = internalQuery({
	args: { limit: v.number() },
	handler: async (ctx, { limit }) =>
		await ctx.db
			.query("posts")
			.withIndex("by_sent", (q) => q.eq("sent", false))
			.take(limit),
});

/**
 * Internal mutation to mark a post as sent (for cron use)
 */
export const markSentInternal = internalMutation({
	args: { id: v.id("posts"), sentAt: v.number() },
	handler: async (ctx, { id, sentAt }) => {
		const post = await ctx.db.get(id);
		if (!post) {
			throw new Error(`Post ${id} not found`);
		}
		await ctx.db.patch(id, { sent: true, sentAt });
	},
});

/**
 * Internal query to get post by shortcode (for cron use)
 */
export const getPostByShortcodeInternal = internalQuery({
	args: { shortcode: v.string() },
	handler: async (ctx, { shortcode }) =>
		await ctx.db
			.query("posts")
			.withIndex("by_shortcode", (q) => q.eq("shortcode", shortcode))
			.first(),
});

/**
 * Internal query to get post by ID (for cron retry use)
 */
export const getPostByIdInternal = internalQuery({
	args: { id: v.id("posts") },
	handler: async (ctx, { id }) => await ctx.db.get(id),
});

/**
 * Internal mutation to upsert a post (for cron use)
 * Timestamps should be in MILLISECONDS
 */
export const upsertPostInternal = internalMutation({
	args: {
		id: v.optional(v.id("posts")),
		ig_id: v.string(),
		shortcode: v.string(),
		display_url: v.string(),
		video_url: v.optional(v.string()),
		thumbnail_url: v.optional(v.string()),
		caption: v.string(),
		is_video: v.boolean(),
		url: v.string(),
		media_type: v.union(
			v.literal("image"),
			v.literal("video"),
			v.literal("carousel"),
		),
		users: v.array(v.id("users")),
		timestamp: v.number(),
		event_date: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const { id, ...data } = args;

		if (id) {
			const existing = await ctx.db.get(id);
			if (!existing) {
				throw new Error(`Post with id ${id} not found`);
			}

			// Merge users arrays
			const existingUsers = existing.users ?? [];
			const mergedUsers = [...new Set([...existingUsers, ...data.users])];

			await ctx.db.patch(id, {
				...data,
				users: mergedUsers,
			});
			return id;
		}

		return await ctx.db.insert("posts", {
			...data,
			sent: false,
		});
	},
});
