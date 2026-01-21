import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
		url: v.string(),
		type: v.union(
			v.literal("image"),
			v.literal("video"),
			v.literal("thumbnail"),
		),
		width: v.optional(v.number()),
		height: v.optional(v.number()),
		post_id: v.id("posts"),
	},
	handler: async (ctx, { id, url, type, width, height, post_id }) => {
		if (id) {
			// Update existing media item by ID
			await ctx.db.patch(id, {
				url,
				type,
				width,
				height,
			});
			return id;
		}
		// Check if media item already exists by URL and post_id
		const items = await ctx.db
			.query("media_items")
			.withIndex("by_post_id", (q) => q.eq("post_id", post_id))
			.collect();
		const existing = items.find((item) => item.url === url);
		if (existing) {
			// Update existing media item
			await ctx.db.patch(existing._id, {
				type,
				width,
				height,
				// url and post_id should remain the same
			});
			return existing._id;
		}
		// Insert new media item
		return await ctx.db.insert("media_items", {
			url,
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
			if (!processedUrls.has(existing.url)) {
				await ctx.db.delete(existing._id);
			}
		}
	},
});
