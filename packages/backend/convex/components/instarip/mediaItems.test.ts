/**
 * Tests for media_items CRUD and sync operations
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("media_items", () => {
	describe("getMediaItems", () => {
		it("returns empty array when no items exist", async () => {
			const t = convexTest(schema, modules);
			const items = await t.query(api.mediaItems.getMediaItems, {});
			expect(items).toHaveLength(0);
		});
	});

	describe("upsertMediaItem", () => {
		it("creates new media item with telegram_file", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const itemId = await t.mutation(api.mediaItems.upsertMediaItem, {
				telegram_file: {
					file_id: "AgACAgIAAxk123",
					file_unique_id: "AQADAgATq1234",
				},
				type: "video",
				post_id: postId,
			});

			const item = await t.query(api.mediaItems.getMediaItemById, {
				id: itemId,
			});
			expect(item?.telegram_file?.file_id).toBe("AgACAgIAAxk123");
			expect(item?.telegram_file?.file_unique_id).toBe("AQADAgATq1234");
		});

		it("creates new media item without telegram_file", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const itemId = await t.mutation(api.mediaItems.upsertMediaItem, {
				type: "image",
				width: 1920,
				height: 1080,
				post_id: postId,
			});

			expect(itemId).toBeDefined();

			const item = await t.query(api.mediaItems.getMediaItemById, {
				id: itemId,
			});
			expect(item?.type).toBe("image");
			expect(item?.width).toBe(1920);
			expect(item?.height).toBe(1080);
			expect(item?.telegram_file).toBeUndefined();
		});

		it("updates existing item when ID provided", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const itemId = await t.mutation(api.mediaItems.upsertMediaItem, {
				type: "image",
				post_id: postId,
			});

			// Update with ID
			await t.mutation(api.mediaItems.upsertMediaItem, {
				id: itemId,
				telegram_file: {
					file_id: "new_file_id",
					file_unique_id: "new_unique_id",
				},
				type: "image",
				post_id: postId,
			});

			const item = await t.query(api.mediaItems.getMediaItemById, {
				id: itemId,
			});
			expect(item?.telegram_file?.file_id).toBe("new_file_id");
			expect(item?.telegram_file?.file_unique_id).toBe("new_unique_id");
		});

		it("finds existing by file_unique_id and updates", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Create initial item
			await t.mutation(api.mediaItems.upsertMediaItem, {
				telegram_file: {
					file_id: "old_file_id",
					file_unique_id: "unique123",
				},
				type: "image",
				post_id: postId,
			});

			// Upsert with same file_unique_id
			await t.mutation(api.mediaItems.upsertMediaItem, {
				telegram_file: {
					file_id: "new_file_id",
					file_unique_id: "unique123",
				},
				type: "image",
				post_id: postId,
			});

			const items = await t.query(api.mediaItems.getMediaItemsByPostId, {
				postId,
			});
			expect(items).toHaveLength(1);
			expect(items[0].telegram_file?.file_id).toBe("new_file_id");
		});
	});

	describe("getMediaItemsByPostId", () => {
		it("returns all items for a post", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "carousel",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Add multiple media items
			await t.mutation(api.mediaItems.upsertMediaItem, {
				type: "image",
				post_id: postId,
			});
			await t.mutation(api.mediaItems.upsertMediaItem, {
				type: "image",
				post_id: postId,
			});

			const items = await t.query(api.mediaItems.getMediaItemsByPostId, {
				postId,
			});
			expect(items).toHaveLength(2);
		});
	});

	describe("syncTelegramMediaItemsForPost", () => {
		it("creates media items with file_ids", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "carousel",
				users: [user._id],
				timestamp: Date.now(),
			});

			await t.mutation(api.mediaItems.syncTelegramMediaItemsForPost, {
				post_id: postId,
				media_items: [
					{
						file_id: "AgACAgIAAxk1",
						file_unique_id: "unique1",
						type: "image",
					},
					{
						file_id: "AgACAgIAAxk2",
						file_unique_id: "unique2",
						type: "video",
						width: 1920,
						height: 1080,
					},
				],
			});

			const items = await t.query(api.mediaItems.getMediaItemsByPostId, {
				postId,
			});
			expect(items).toHaveLength(2);
			expect(
				items.some((i) => i.telegram_file?.file_unique_id === "unique1"),
			).toBe(true);
			expect(
				items.some((i) => i.telegram_file?.file_unique_id === "unique2"),
			).toBe(true);
		});

		it("updates existing items by file_unique_id", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Create initial
			await t.mutation(api.mediaItems.syncTelegramMediaItemsForPost, {
				post_id: postId,
				media_items: [
					{ file_id: "old_id", file_unique_id: "unique1", type: "image" },
				],
			});

			// Sync with updated file_id
			await t.mutation(api.mediaItems.syncTelegramMediaItemsForPost, {
				post_id: postId,
				media_items: [
					{ file_id: "new_id", file_unique_id: "unique1", type: "image" },
				],
			});

			const items = await t.query(api.mediaItems.getMediaItemsByPostId, {
				postId,
			});
			expect(items).toHaveLength(1);
			expect(items[0].telegram_file?.file_id).toBe("new_id");
		});

		it("deletes items not in sync list", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "carousel",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Create with 2 items
			await t.mutation(api.mediaItems.syncTelegramMediaItemsForPost, {
				post_id: postId,
				media_items: [
					{ file_id: "id1", file_unique_id: "unique1", type: "image" },
					{ file_id: "id2", file_unique_id: "unique2", type: "image" },
				],
			});

			// Sync with only 1 item
			await t.mutation(api.mediaItems.syncTelegramMediaItemsForPost, {
				post_id: postId,
				media_items: [
					{ file_id: "id1", file_unique_id: "unique1", type: "image" },
				],
			});

			const items = await t.query(api.mediaItems.getMediaItemsByPostId, {
				postId,
			});
			expect(items).toHaveLength(1);
			expect(items[0].telegram_file?.file_unique_id).toBe("unique1");
		});
	});

	describe("getMediaItemsNeedingBackfill", () => {
		it("returns items without telegram_file", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "carousel",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Create items - one with telegram_file, one without
			await t.mutation(api.mediaItems.upsertMediaItem, {
				type: "image",
				post_id: postId,
			});
			await t.mutation(api.mediaItems.upsertMediaItem, {
				telegram_file: {
					file_id: "AgACAgIAAxk",
					file_unique_id: "AQADAgATq",
				},
				type: "image",
				post_id: postId,
			});

			const needingBackfill = await t.query(
				api.mediaItems.getMediaItemsNeedingBackfill,
				{ postId },
			);
			expect(needingBackfill).toHaveLength(1);
			expect(needingBackfill[0].telegram_file).toBeUndefined();
		});

		it("returns empty when all have telegram_file", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			await t.mutation(api.mediaItems.upsertMediaItem, {
				telegram_file: {
					file_id: "AgACAgIAAxk",
					file_unique_id: "AQADAgATq",
				},
				type: "image",
				post_id: postId,
			});

			const needingBackfill = await t.query(
				api.mediaItems.getMediaItemsNeedingBackfill,
				{ postId },
			);
			expect(needingBackfill).toHaveLength(0);
		});
	});

	describe("updateMediaItemWithFileIdByPosition", () => {
		it("updates media item by position", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "carousel",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Create two items
			await t.mutation(api.mediaItems.upsertMediaItem, {
				type: "image",
				post_id: postId,
			});
			await t.mutation(api.mediaItems.upsertMediaItem, {
				type: "video",
				post_id: postId,
			});

			// Update the second item (position 1)
			await t.mutation(api.mediaItems.updateMediaItemWithFileIdByPosition, {
				post_id: postId,
				position: 1,
				file_id: "AgACAgIAAxk",
				file_unique_id: "AQADAgATq",
			});

			const items = await t.query(api.mediaItems.getMediaItemsByPostId, {
				postId,
			});
			// Sort by creation time to get consistent ordering
			const sortedItems = items.sort(
				(a, b) => a._creationTime - b._creationTime,
			);
			expect(sortedItems[0].telegram_file).toBeUndefined();
			expect(sortedItems[1].telegram_file?.file_id).toBe("AgACAgIAAxk");
			expect(sortedItems[1].telegram_file?.file_unique_id).toBe("AQADAgATq");
		});

		it("handles out-of-bounds position silently (no-op)", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "carousel",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Create only one item
			await t.mutation(api.mediaItems.upsertMediaItem, {
				type: "image",
				post_id: postId,
			});

			// Try to update at out-of-bounds position (position 5 when only 1 item exists)
			await expect(
				t.mutation(api.mediaItems.updateMediaItemWithFileIdByPosition, {
					post_id: postId,
					position: 5,
					file_id: "AgACAgIAAxk",
					file_unique_id: "AQADAgATq",
				}),
			).resolves.toBeNull();

			// Verify the single item was not affected
			const items = await t.query(api.mediaItems.getMediaItemsByPostId, {
				postId,
			});
			expect(items).toHaveLength(1);
			expect(items[0].telegram_file).toBeUndefined();
		});
	});

	describe("deleteMediaItem", () => {
		it("removes media item", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const itemId = await t.mutation(api.mediaItems.upsertMediaItem, {
				type: "image",
				post_id: postId,
			});

			await t.mutation(api.mediaItems.deleteMediaItem, { id: itemId });

			const item = await t.query(api.mediaItems.getMediaItemById, {
				id: itemId,
			});
			expect(item).toBeNull();
		});
	});

	describe("telegram_file field preservation", () => {
		it("preserves existing fields when updating with telegram_file", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Create item with dimensions
			const itemId = await t.mutation(api.mediaItems.upsertMediaItem, {
				type: "video",
				width: 1920,
				height: 1080,
				post_id: postId,
			});

			// Update with telegram_file using ID
			await t.mutation(api.mediaItems.updateMediaItemFileIdById, {
				id: itemId,
				file_id: "AgACAgIAAxk",
				file_unique_id: "AQADAgATq",
			});

			const items = await t.query(api.mediaItems.getMediaItemsByPostId, {
				postId,
			});
			expect(items).toHaveLength(1);
			// Original fields preserved
			expect(items[0].type).toBe("video");
			expect(items[0].width).toBe(1920);
			expect(items[0].height).toBe(1080);
			// New telegram_file fields added
			expect(items[0].telegram_file?.file_id).toBe("AgACAgIAAxk");
			expect(items[0].telegram_file?.file_unique_id).toBe("AQADAgATq");
		});
	});

	describe("media source scenarios", () => {
		it("handles telegram_file-only media item (Telegram native)", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const itemId = await t.mutation(api.mediaItems.upsertMediaItem, {
				telegram_file: {
					file_id: "AgACAgIAAxkFileOnly",
					file_unique_id: "AQADAgATqFileOnly",
				},
				type: "image",
				post_id: postId,
			});

			const item = await t.query(api.mediaItems.getMediaItemById, {
				id: itemId,
			});
			expect(item?.telegram_file?.file_id).toBe("AgACAgIAAxkFileOnly");
			expect(item?.telegram_file?.file_unique_id).toBe("AQADAgATqFileOnly");
		});

		it("handles media item without telegram_file (pending backfill)", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const itemId = await t.mutation(api.mediaItems.upsertMediaItem, {
				type: "image",
				width: 1920,
				height: 1080,
				post_id: postId,
			});

			const item = await t.query(api.mediaItems.getMediaItemById, {
				id: itemId,
			});
			expect(item?.telegram_file).toBeUndefined();
			expect(item?.type).toBe("image");
			expect(item?.width).toBe(1920);
		});
	});
});
