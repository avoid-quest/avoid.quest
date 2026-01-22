import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

/**
 * Media type validator for posts
 */
const postMediaTypeValidator = v.union(
	v.literal("image"),
	v.literal("video"),
	v.literal("carousel"),
);

/**
 * Post status validator - state machine for sending lifecycle
 */
const postStatusValidator = v.union(
	v.literal("pending"),
	v.literal("sending"),
	v.literal("sent"),
	v.literal("failed"),
);

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
	media_type: postMediaTypeValidator,
	users: v.array(v.id("users")),
	timestamp: v.number(),
	event_date: v.optional(v.number()),
	status: postStatusValidator,
	sentAt: v.optional(v.number()),
});

/**
 * Get posts ordered by event date (public API)
 */
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
 * Get post by ID
 */
export const getPostById = query({
	args: { id: v.id("posts") },
	handler: async (ctx, { id }) => await ctx.db.get(id),
});

/**
 * Get posts by user ID
 */
export const getPostsByUserId = query({
	args: { userId: v.id("users") },
	handler: async (ctx, { userId }) =>
		await ctx.db
			.query("posts")
			.withIndex("by_user_id", (q) => q.eq("users", [userId]))
			.collect(),
});

/**
 * Get post by shortcode
 */
export const getPostByShortcode = query({
	args: { shortcode: v.string() },
	handler: async (ctx, { shortcode }) =>
		await ctx.db
			.query("posts")
			.withIndex("by_shortcode", (q) => q.eq("shortcode", shortcode))
			.first(),
});

/**
 * Get unsent posts (only pending posts, excludes sending or failed)
 */
export const getUnsent = query({
	args: { limit: v.number() },
	handler: async (ctx, { limit }) => {
		// Using the status index, only fetch posts with status="pending"
		return await ctx.db
			.query("posts")
			.withIndex("by_status", (q) => q.eq("status", "pending"))
			.take(limit);
	},
});

/**
 * Get posts with pagination
 */
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

/**
 * Get unsent posts with pagination
 */
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
			.withIndex("by_status", (q) => q.eq("status", "pending"))
			.order("desc")
			.paginate(paginationOpts);
		return {
			page: result.page,
			isDone: result.isDone,
			continueCursor: result.continueCursor,
		};
	},
});

/**
 * Upsert a post (create or update)
 * Timestamps should be in MILLISECONDS
 */
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
		media_type: postMediaTypeValidator,
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
			status: "pending",
		});
	},
});

/**
 * Delete a post
 */
export const deletePost = mutation({
	args: { id: v.id("posts") },
	handler: async (ctx, { id }) => await ctx.db.delete(id),
});

/**
 * Mark a post as sent to Telegram.
 *
 * @param id - The post ID to mark as sent
 * @param sentAt - Timestamp in MILLISECONDS (use Date.now())
 */
export const markSent = mutation({
	args: { id: v.id("posts"), sentAt: v.number() },
	handler: async (ctx, { id, sentAt }) => {
		const post = await ctx.db.get(id);
		if (!post) {
			throw new Error(`Post ${id} not found`);
		}
		await ctx.db.patch(id, { status: "sent", sentAt });
		return null;
	},
});

/**
 * Atomically claim a post for sending (prevents concurrent sends)
 * Returns true if the post was successfully claimed, false if already being sent
 *
 * State transitions:
 * - pending → sending (success, returns true)
 * - sending → (no change, returns false - already claimed)
 * - sent → (no change, returns false - already sent)
 * - failed → (no change, returns false - permanently failed)
 */
export const claimForSending = mutation({
	args: { id: v.id("posts") },
	returns: v.boolean(),
	handler: async (ctx, { id }) => {
		const post = await ctx.db.get(id);
		if (!post) {
			return false;
		}

		// Only pending posts can be claimed
		if (post.status !== "pending") {
			return false;
		}

		// Claim the post by transitioning to "sending" state
		await ctx.db.patch(id, { status: "sending" });
		return true;
	},
});

/**
 * Clear the sending state (called after send failure to allow retry)
 *
 * State transitions:
 * - sending → pending (allows retry)
 * - other states → (no change)
 */
export const clearSending = mutation({
	args: { id: v.id("posts") },
	handler: async (ctx, { id }) => {
		const post = await ctx.db.get(id);
		if (post && post.status === "sending") {
			await ctx.db.patch(id, { status: "pending" });
		}
	},
});

/**
 * Mark a post as permanently failed (after max retries exceeded)
 *
 * State transitions:
 * - any state → failed (permanent failure)
 */
export const markSendFailed = mutation({
	args: { id: v.id("posts") },
	handler: async (ctx, { id }) => {
		const post = await ctx.db.get(id);
		if (post) {
			await ctx.db.patch(id, { status: "failed" });
		}
	},
});

/**
 * Increment retry count and return the new count
 */
export const incrementRetryCount = mutation({
	args: { id: v.id("posts") },
	returns: v.number(),
	handler: async (ctx, { id }) => {
		const post = await ctx.db.get(id);
		if (!post) {
			return 0;
		}
		const newCount = (post.retry_count ?? 0) + 1;
		await ctx.db.patch(id, { retry_count: newCount });
		return newCount;
	},
});

/**
 * Get statistics for backfill progress.
 * Returns counts of posts with and without telegram_file in their media items.
 *
 * @note This query collects all sent posts and media items into memory.
 * For very large datasets, consider implementing incremental stats tracking.
 */
export const getBackfillStats = query({
	handler: async (ctx) => {
		// Get all sent posts - potential OOM risk with very large datasets
		const sentPosts = await ctx.db
			.query("posts")
			.withIndex("by_status", (q) => q.eq("status", "sent"))
			.collect();

		if (sentPosts.length === 0) {
			return { totalSent: 0, withFileIds: 0, needsBackfill: 0 };
		}

		// Create a Set of sent post IDs for fast lookup
		const sentPostIds = new Set(sentPosts.map((p) => p._id));

		// Get all media items in one query and group by post_id
		const allMediaItems = await ctx.db.query("media_items").collect();

		// Group media items by post_id and track telegram_file status
		const mediaByPost = new Map<
			Id<"posts">,
			{ total: number; withTelegramFile: number }
		>();

		for (const item of allMediaItems) {
			// Only process media items for sent posts
			if (!sentPostIds.has(item.post_id)) {
				continue;
			}

			const current = mediaByPost.get(item.post_id) ?? {
				total: 0,
				withTelegramFile: 0,
			};
			current.total++;
			if (item.telegram_file) {
				current.withTelegramFile++;
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
			if (media.withTelegramFile === media.total) {
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
