import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Media type validator
 */
const mediaTypeValidator = v.union(
	v.literal("image"),
	v.literal("video"),
	v.literal("thumbnail"),
);

/**
 * Instagram media item validator (URL-based)
 */
const instagramMediaItemValidator = v.object({
	url: v.string(),
	type: mediaTypeValidator,
	width: v.optional(v.number()),
	height: v.optional(v.number()),
});

/**
 * Telegram file ID item validator
 */
const telegramFileIdItemValidator = v.object({
	file_id: v.string(),
	file_unique_id: v.string(),
	type: mediaTypeValidator,
	width: v.optional(v.number()),
	height: v.optional(v.number()),
});

/**
 * Get all media items
 */
export const getMediaItems = query({
	args: {},
	handler: async (ctx) => await ctx.db.query("media_items").collect(),
});

/**
 * Get media item by ID
 */
export const getMediaItemById = query({
	args: { id: v.id("media_items") },
	handler: async (ctx, { id }) => await ctx.db.get(id),
});

/**
 * Get media items by post ID
 */
export const getMediaItemsByPostId = query({
	args: { postId: v.id("posts") },
	handler: async (ctx, { postId }) =>
		await ctx.db
			.query("media_items")
			.withIndex("by_post_id", (q) => q.eq("post_id", postId))
			.collect(),
});

/**
 * Get media item by type and post ID
 */
export const getMediaItemByTypeAndPostId = query({
	args: { type: mediaTypeValidator, postId: v.id("posts") },
	handler: async (ctx, { type, postId }) => {
		const items = await ctx.db
			.query("media_items")
			.withIndex("by_post_id", (q) => q.eq("post_id", postId))
			.collect();
		return items.find((item) => item.type === type) ?? null;
	},
});

/**
 * Upsert a media item
 */
export const upsertMediaItem = mutation({
	args: {
		id: v.optional(v.id("media_items")),
		file_id: v.optional(v.string()),
		file_unique_id: v.optional(v.string()),
		type: mediaTypeValidator,
		width: v.optional(v.number()),
		height: v.optional(v.number()),
		post_id: v.id("posts"),
	},
	handler: async (
		ctx,
		{ id, file_id, file_unique_id, type, width, height, post_id },
	) => {
		if (id) {
			// Update existing media item by ID
			await ctx.db.patch(id, {
				file_id,
				file_unique_id,
				type,
				width,
				height,
			});
			return id;
		}

		// Check for existing item by file_unique_id
		const items = await ctx.db
			.query("media_items")
			.withIndex("by_post_id", (q) => q.eq("post_id", post_id))
			.collect();

		let existing = null;
		if (file_unique_id) {
			existing = items.find((item) => item.file_unique_id === file_unique_id);
		}

		if (existing) {
			// Update existing media item
			await ctx.db.patch(existing._id, {
				type,
				width,
				height,
				...(file_id && { file_id }),
				...(file_unique_id && { file_unique_id }),
			});
			return existing._id;
		}

		// Insert new media item
		return await ctx.db.insert("media_items", {
			file_id,
			file_unique_id,
			type,
			width,
			height,
			post_id,
		});
	},
});

/**
 * Delete a media item
 */
export const deleteMediaItem = mutation({
	args: { id: v.id("media_items") },
	handler: async (ctx, { id }) => await ctx.db.delete(id),
});

/**
 * Sync media items for a post from Instagram
 * - Creates media items with type and dimensions
 * - Media items will be updated with file_ids when sent to Telegram
 */
export const syncMediaItemsForPost = mutation({
	args: {
		post_id: v.id("posts"),
		media_items: v.array(instagramMediaItemValidator),
	},
	handler: async (ctx, { post_id, media_items }) => {
		// Get all existing media items for this post
		const existingItems = await ctx.db
			.query("media_items")
			.withIndex("by_post_id", (q) => q.eq("post_id", post_id))
			.collect();

		// Delete existing items (fresh sync)
		for (const existing of existingItems) {
			await ctx.db.delete(existing._id);
		}

		// Insert new items (without URL storage)
		for (const item of media_items) {
			await ctx.db.insert("media_items", {
				type: item.type,
				width: item.width,
				height: item.height,
				post_id,
			});
		}
	},
});

/**
 * Sync media items for a post using Telegram file_ids.
 * This is the preferred method as file_ids never expire.
 */
export const syncTelegramMediaItemsForPost = mutation({
	args: {
		post_id: v.id("posts"),
		media_items: v.array(telegramFileIdItemValidator),
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
 * Update a media item with Telegram file_id by matching post_id and position
 */
export const updateMediaItemWithFileIdByPosition = mutation({
	args: {
		post_id: v.id("posts"),
		position: v.number(),
		file_id: v.string(),
		file_unique_id: v.string(),
	},
	handler: async (ctx, { post_id, position, file_id, file_unique_id }) => {
		// Find media items by post_id and use position to match
		const items = await ctx.db
			.query("media_items")
			.withIndex("by_post_id", (q) => q.eq("post_id", post_id))
			.collect();

		// Sort by creation time to get consistent ordering
		const sortedItems = items.sort((a, b) => a._creationTime - b._creationTime);
		const item = sortedItems[position];
		if (item) {
			await ctx.db.patch(item._id, { file_id, file_unique_id });
		}
	},
});

/**
 * Update a media item's file_id by document ID
 * Fallback for when URL-based matching isn't possible
 */
export const updateMediaItemFileIdById = mutation({
	args: {
		id: v.id("media_items"),
		file_id: v.string(),
		file_unique_id: v.string(),
	},
	handler: async (ctx, { id, file_id, file_unique_id }) => {
		const item = await ctx.db.get(id);
		if (item) {
			await ctx.db.patch(id, { file_id, file_unique_id });
		}
	},
});
