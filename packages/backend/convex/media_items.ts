import { v } from "convex/values";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";

export const getMediaItems = query({
	args: {},
	handler: async (ctx) => await ctx.db.query("media_items").collect(),
});

export const getMediaItemById = query({
	args: { id: v.id("media_items") },
	handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const getMediaItemsByPostId = query({
	args: { postId: v.id("posts") },
	handler: async (ctx, { postId }) =>
		await ctx.db
			.query("media_items")
			.withIndex("by_post_id", (q) => q.eq("post_id", postId))
			.collect(),
});

export const getMediaItemByUrlAndPostId = query({
	args: { url: v.string(), postId: v.id("posts") },
	handler: async (ctx, { url, postId }) => {
		// Query by post_id first (indexed), then filter by URL
		const items = await ctx.db
			.query("media_items")
			.withIndex("by_post_id", (q) => q.eq("post_id", postId))
			.collect();
		return items.find((item) => item.url === url) ?? null;
	},
});

export const upsertMediaItem = mutation({
	args: {
		id: v.optional(v.id("media_items")),
		url: v.optional(v.string()),
		file_id: v.optional(v.string()),
		file_unique_id: v.optional(v.string()),
		type: v.union(
			v.literal("image"),
			v.literal("video"),
			v.literal("thumbnail"),
		),
		width: v.optional(v.number()),
		height: v.optional(v.number()),
		post_id: v.id("posts"),
	},
	handler: async (
		ctx,
		{ id, url, file_id, file_unique_id, type, width, height, post_id },
	) => {
		if (id) {
			// Update existing media item by ID
			await ctx.db.patch(id, {
				url,
				file_id,
				file_unique_id,
				type,
				width,
				height,
			});
			return id;
		}

		// Check for existing item - prefer file_unique_id match, then url match
		// Note: Uses by_post_id index then in-memory search. This is efficient because
		// posts typically have < 10 media items. Adding indexes on file_unique_id/url
		// would complicate the schema for minimal benefit.
		const items = await ctx.db
			.query("media_items")
			.withIndex("by_post_id", (q) => q.eq("post_id", post_id))
			.collect();

		let existing = null;
		if (file_unique_id) {
			existing = items.find((item) => item.file_unique_id === file_unique_id);
		}
		if (!existing && url) {
			existing = items.find((item) => item.url === url);
		}

		if (existing) {
			// Update existing media item
			await ctx.db.patch(existing._id, {
				type,
				width,
				height,
				...(url && { url }),
				...(file_id && { file_id }),
				...(file_unique_id && { file_unique_id }),
			});
			return existing._id;
		}

		// Insert new media item
		return await ctx.db.insert("media_items", {
			url,
			file_id,
			file_unique_id,
			type,
			width,
			height,
			post_id,
		});
	},
});

export const deleteMediaItem = mutation({
	args: { id: v.id("media_items") },
	handler: async (ctx, { id }) => await ctx.db.delete(id),
});

/**
 * Sync media items for a post. This function:
 * - Updates existing media items that match by URL
 * - Adds new media items
 * - Deletes media items that are no longer in the provided list
 *
 * This ensures the database stays in sync with the retrieved data.
 * @deprecated Use syncTelegramMediaItemsForPost for file_id-based media
 */
export const syncMediaItemsForPost = mutation({
	args: {
		post_id: v.id("posts"),
		media_items: v.array(
			v.object({
				url: v.string(),
				type: v.union(
					v.literal("image"),
					v.literal("video"),
					v.literal("thumbnail"),
				),
				width: v.optional(v.number()),
				height: v.optional(v.number()),
			}),
		),
	},
	handler: async (ctx, { post_id, media_items }) => {
		// Get all existing media items for this post
		const existingItems = await ctx.db
			.query("media_items")
			.withIndex("by_post_id", (q) => q.eq("post_id", post_id))
			.collect();

		// Create a map of existing items by URL for quick lookup
		const existingByUrl = new Map(
			existingItems.map((item) => [item.url, item]),
		);

		// Track which URLs we've processed
		const processedUrls = new Set<string>();

		// Upsert all provided media items
		for (const item of media_items) {
			processedUrls.add(item.url);
			const existing = existingByUrl.get(item.url);

			if (existing) {
				// Update existing item if any properties changed
				await ctx.db.patch(existing._id, {
					type: item.type,
					width: item.width,
					height: item.height,
					// url and post_id remain the same
				});
			} else {
				// Insert new item
				await ctx.db.insert("media_items", {
					url: item.url,
					type: item.type,
					width: item.width,
					height: item.height,
					post_id,
				});
			}
		}

		// Delete items that are no longer in the provided list
		for (const existing of existingItems) {
			if (existing.url && !processedUrls.has(existing.url)) {
				await ctx.db.delete(existing._id);
			}
		}
	},
});

/**
 * Sync media items for a post using Telegram file_ids.
 * This is the preferred method as file_ids never expire.
 *
 * - Updates existing media items that match by file_unique_id
 * - Adds new media items
 * - Deletes media items that are no longer in the provided list
 */
export const syncTelegramMediaItemsForPost = mutation({
	args: {
		post_id: v.id("posts"),
		media_items: v.array(
			v.object({
				file_id: v.string(),
				file_unique_id: v.string(),
				type: v.union(
					v.literal("image"),
					v.literal("video"),
					v.literal("thumbnail"),
				),
				width: v.optional(v.number()),
				height: v.optional(v.number()),
			}),
		),
	},
	handler: async (ctx, { post_id, media_items }) => {
		// Get all existing media items for this post
		const existingItems = await ctx.db
			.query("media_items")
			.withIndex("by_post_id", (q) => q.eq("post_id", post_id))
			.collect();

		// Create a map of existing items by file_unique_id for quick lookup
		const existingByUniqueId = new Map(
			existingItems
				.filter((item) => item.file_unique_id)
				.map((item) => [item.file_unique_id, item]),
		);

		// Track which file_unique_ids we've processed
		const processedUniqueIds = new Set<string>();

		// Upsert all provided media items
		for (const item of media_items) {
			processedUniqueIds.add(item.file_unique_id);
			const existing = existingByUniqueId.get(item.file_unique_id);

			if (existing) {
				// Update existing item - file_id might change but file_unique_id stays same
				await ctx.db.patch(existing._id, {
					file_id: item.file_id,
					type: item.type,
					width: item.width,
					height: item.height,
				});
			} else {
				// Insert new item
				await ctx.db.insert("media_items", {
					file_id: item.file_id,
					file_unique_id: item.file_unique_id,
					type: item.type,
					width: item.width,
					height: item.height,
					post_id,
				});
			}
		}

		// Delete items that are no longer in the provided list
		// This includes:
		// 1. Migrated items (with file_unique_id) not in the new list
		// 2. Legacy URL-only items (without file_unique_id) - cleanup during migration
		for (const existing of existingItems) {
			if (existing.file_unique_id) {
				// Migrated item - delete if not in new list
				if (!processedUniqueIds.has(existing.file_unique_id)) {
					await ctx.db.delete(existing._id);
				}
			} else {
				// Legacy URL-only item - delete to clean up
				await ctx.db.delete(existing._id);
			}
		}
	},
});

/**
 * Update existing media items with Telegram file_ids during backfill.
 * This is used when processing forwarded messages to extract file_ids
 * from already-sent posts.
 */
export const updateMediaItemWithFileId = mutation({
	args: {
		id: v.id("media_items"),
		file_id: v.string(),
		file_unique_id: v.string(),
	},
	handler: async (ctx, { id, file_id, file_unique_id }) => {
		await ctx.db.patch(id, { file_id, file_unique_id });
	},
});

/**
 * Get media items for a post that are missing file_ids (need backfill)
 */
export const getMediaItemsNeedingBackfill = query({
	args: { postId: v.id("posts") },
	handler: async (ctx, { postId }) => {
		const items = await ctx.db
			.query("media_items")
			.withIndex("by_post_id", (q) => q.eq("post_id", postId))
			.collect();

		return items.filter((item) => !item.file_id);
	},
});

/**
 * Internal query to get media items by post ID (for cron use)
 */
export const getMediaItemsByPostIdInternal = internalQuery({
	args: { postId: v.id("posts") },
	handler: async (ctx, { postId }) =>
		await ctx.db
			.query("media_items")
			.withIndex("by_post_id", (q) => q.eq("post_id", postId))
			.collect(),
});

/**
 * Internal mutation to sync media items for a post (for cron use)
 * URL-based media items from Instagram
 */
export const syncMediaItemsForPostInternal = internalMutation({
	args: {
		post_id: v.id("posts"),
		media_items: v.array(
			v.object({
				url: v.string(),
				type: v.union(
					v.literal("image"),
					v.literal("video"),
					v.literal("thumbnail"),
				),
				width: v.optional(v.number()),
				height: v.optional(v.number()),
			}),
		),
	},
	handler: async (ctx, { post_id, media_items }) => {
		// Get existing media items
		const existingItems = await ctx.db
			.query("media_items")
			.withIndex("by_post_id", (q) => q.eq("post_id", post_id))
			.collect();

		const existingByUrl = new Map(
			existingItems.map((item) => [item.url, item]),
		);
		const processedUrls = new Set<string>();

		for (const item of media_items) {
			processedUrls.add(item.url);
			const existing = existingByUrl.get(item.url);

			if (existing) {
				await ctx.db.patch(existing._id, {
					type: item.type,
					width: item.width,
					height: item.height,
				});
			} else {
				await ctx.db.insert("media_items", {
					url: item.url,
					type: item.type,
					width: item.width,
					height: item.height,
					post_id,
				});
			}
		}

		// Delete items no longer present
		for (const existing of existingItems) {
			if (existing.url && !processedUrls.has(existing.url)) {
				await ctx.db.delete(existing._id);
			}
		}
	},
});
