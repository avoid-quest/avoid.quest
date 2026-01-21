/**
 * Tests for media_items CRUD and sync operations
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("media_items", () => {
	describe("getMediaItems", () => {
		it("returns empty array when no items exist", async () => {
			const t = convexTest(schema, modules);
			const items = await t.query(api.media_items.getMediaItems, {});
			expect(items).toHaveLength(0);
		});
	});

	describe("upsertMediaItem", () => {
		it("creates new media item with URL", async () => {
			const t = convexTest(schema, modules);

			// Create a post first
			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			const itemId = await t.mutation(api.media_items.upsertMediaItem, {
				url: "https://example.com/media.jpg",
				type: "image",
				width: 1920,
				height: 1080,
				post_id: postId,
			});

			expect(itemId).toBeDefined();

			const item = await t.query(api.media_items.getMediaItemById, {
				id: itemId,
			});
			expect(item?.url).toBe("https://example.com/media.jpg");
			expect(item?.type).toBe("image");
			expect(item?.width).toBe(1920);
			expect(item?.height).toBe(1080);
		});

		it("creates new media item with file_id", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			const itemId = await t.mutation(api.media_items.upsertMediaItem, {
				file_id: "AgACAgIAAxk123",
				file_unique_id: "AQADAgATq1234",
				type: "video",
				post_id: postId,
			});

			const item = await t.query(api.media_items.getMediaItemById, {
				id: itemId,
			});
			expect(item?.file_id).toBe("AgACAgIAAxk123");
			expect(item?.file_unique_id).toBe("AQADAgATq1234");
		});

		it("updates existing item when ID provided", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			const itemId = await t.mutation(api.media_items.upsertMediaItem, {
				url: "https://example.com/old.jpg",
				type: "image",
				post_id: postId,
			});

			// Update with ID
			await t.mutation(api.media_items.upsertMediaItem, {
				id: itemId,
				url: "https://example.com/new.jpg",
				type: "image",
				post_id: postId,
			});

			const item = await t.query(api.media_items.getMediaItemById, {
				id: itemId,
			});
			expect(item?.url).toBe("https://example.com/new.jpg");
		});

		it("finds existing by file_unique_id and updates", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			// Create initial item
			await t.mutation(api.media_items.upsertMediaItem, {
				file_id: "old_file_id",
				file_unique_id: "unique123",
				type: "image",
				post_id: postId,
			});

			// Upsert with same file_unique_id
			await t.mutation(api.media_items.upsertMediaItem, {
				file_id: "new_file_id",
				file_unique_id: "unique123",
				type: "image",
				post_id: postId,
			});

			const items = await t.query(api.media_items.getMediaItemsByPostId, {
				postId,
			});
			expect(items).toHaveLength(1);
			expect(items[0].file_id).toBe("new_file_id");
		});
	});

	describe("getMediaItemsByPostId", () => {
		it("returns all items for a post", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "carousel",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			// Add multiple media items
			await t.mutation(api.media_items.upsertMediaItem, {
				url: "https://example.com/1.jpg",
				type: "image",
				post_id: postId,
			});
			await t.mutation(api.media_items.upsertMediaItem, {
				url: "https://example.com/2.jpg",
				type: "image",
				post_id: postId,
			});

			const items = await t.query(api.media_items.getMediaItemsByPostId, {
				postId,
			});
			expect(items).toHaveLength(2);
		});
	});

	describe("syncTelegramMediaItemsForPost", () => {
		it("creates media items with file_ids", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "carousel",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			await t.mutation(api.media_items.syncTelegramMediaItemsForPost, {
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

			const items = await t.query(api.media_items.getMediaItemsByPostId, {
				postId,
			});
			expect(items).toHaveLength(2);
			expect(items.some((i) => i.file_unique_id === "unique1")).toBe(true);
			expect(items.some((i) => i.file_unique_id === "unique2")).toBe(true);
		});

		it("updates existing items by file_unique_id", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			// Create initial
			await t.mutation(api.media_items.syncTelegramMediaItemsForPost, {
				post_id: postId,
				media_items: [
					{ file_id: "old_id", file_unique_id: "unique1", type: "image" },
				],
			});

			// Sync with updated file_id
			await t.mutation(api.media_items.syncTelegramMediaItemsForPost, {
				post_id: postId,
				media_items: [
					{ file_id: "new_id", file_unique_id: "unique1", type: "image" },
				],
			});

			const items = await t.query(api.media_items.getMediaItemsByPostId, {
				postId,
			});
			expect(items).toHaveLength(1);
			expect(items[0].file_id).toBe("new_id");
		});

		it("deletes items not in sync list", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "carousel",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			// Create with 2 items
			await t.mutation(api.media_items.syncTelegramMediaItemsForPost, {
				post_id: postId,
				media_items: [
					{ file_id: "id1", file_unique_id: "unique1", type: "image" },
					{ file_id: "id2", file_unique_id: "unique2", type: "image" },
				],
			});

			// Sync with only 1 item
			await t.mutation(api.media_items.syncTelegramMediaItemsForPost, {
				post_id: postId,
				media_items: [
					{ file_id: "id1", file_unique_id: "unique1", type: "image" },
				],
			});

			const items = await t.query(api.media_items.getMediaItemsByPostId, {
				postId,
			});
			expect(items).toHaveLength(1);
			expect(items[0].file_unique_id).toBe("unique1");
		});
	});

	describe("getMediaItemsNeedingBackfill", () => {
		it("returns items without file_id", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "carousel",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			// Create items - one with file_id, one without
			await t.mutation(api.media_items.upsertMediaItem, {
				url: "https://example.com/1.jpg",
				type: "image",
				post_id: postId,
			});
			await t.mutation(api.media_items.upsertMediaItem, {
				url: "https://example.com/2.jpg",
				file_id: "AgACAgIAAxk",
				type: "image",
				post_id: postId,
			});

			const needingBackfill = await t.query(
				api.media_items.getMediaItemsNeedingBackfill,
				{ postId },
			);
			expect(needingBackfill).toHaveLength(1);
			expect(needingBackfill[0].url).toBe("https://example.com/1.jpg");
		});

		it("returns empty when all have file_ids", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			await t.mutation(api.media_items.upsertMediaItem, {
				url: "https://example.com/1.jpg",
				file_id: "AgACAgIAAxk",
				type: "image",
				post_id: postId,
			});

			const needingBackfill = await t.query(
				api.media_items.getMediaItemsNeedingBackfill,
				{ postId },
			);
			expect(needingBackfill).toHaveLength(0);
		});
	});

	describe("updateMediaItemWithFileIdInternal", () => {
		it("updates media item by URL match", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			await t.mutation(api.media_items.upsertMediaItem, {
				url: "https://example.com/target.jpg",
				type: "image",
				post_id: postId,
			});

			await t.mutation(internal.media_items.updateMediaItemWithFileIdInternal, {
				post_id: postId,
				url: "https://example.com/target.jpg",
				file_id: "AgACAgIAAxk",
				file_unique_id: "AQADAgATq",
			});

			const items = await t.query(api.media_items.getMediaItemsByPostId, {
				postId,
			});
			expect(items[0].file_id).toBe("AgACAgIAAxk");
			expect(items[0].file_unique_id).toBe("AQADAgATq");
		});
	});

	describe("deleteMediaItem", () => {
		it("removes media item", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			const itemId = await t.mutation(api.media_items.upsertMediaItem, {
				url: "https://example.com/image.jpg",
				type: "image",
				post_id: postId,
			});

			await t.mutation(api.media_items.deleteMediaItem, { id: itemId });

			const item = await t.query(api.media_items.getMediaItemById, {
				id: itemId,
			});
			expect(item).toBeNull();
		});
	});

	describe("file_id field preservation", () => {
		it("preserves existing fields when adding file_id", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			// Create item with URL and dimensions
			await t.mutation(api.media_items.upsertMediaItem, {
				url: "https://example.com/media.jpg",
				type: "video",
				width: 1920,
				height: 1080,
				post_id: postId,
			});

			// Update with file_id via internal mutation
			await t.mutation(internal.media_items.updateMediaItemWithFileIdInternal, {
				post_id: postId,
				url: "https://example.com/media.jpg",
				file_id: "AgACAgIAAxk",
				file_unique_id: "AQADAgATq",
			});

			const items = await t.query(api.media_items.getMediaItemsByPostId, {
				postId,
			});
			expect(items).toHaveLength(1);
			// Original fields preserved
			expect(items[0].url).toBe("https://example.com/media.jpg");
			expect(items[0].type).toBe("video");
			expect(items[0].width).toBe(1920);
			expect(items[0].height).toBe(1080);
			// New file_id fields added
			expect(items[0].file_id).toBe("AgACAgIAAxk");
			expect(items[0].file_unique_id).toBe("AQADAgATq");
		});
	});

	describe("media source scenarios", () => {
		it("handles URL-only media item (legacy)", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			const itemId = await t.mutation(api.media_items.upsertMediaItem, {
				url: "https://example.com/url-only.jpg",
				type: "image",
				post_id: postId,
			});

			const item = await t.query(api.media_items.getMediaItemById, {
				id: itemId,
			});
			expect(item?.url).toBe("https://example.com/url-only.jpg");
			expect(item?.file_id).toBeUndefined();
			expect(item?.file_unique_id).toBeUndefined();
		});

		it("handles file_id-only media item (Telegram native)", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			const itemId = await t.mutation(api.media_items.upsertMediaItem, {
				file_id: "AgACAgIAAxkFileOnly",
				file_unique_id: "AQADAgATqFileOnly",
				type: "image",
				post_id: postId,
			});

			const item = await t.query(api.media_items.getMediaItemById, {
				id: itemId,
			});
			expect(item?.url).toBeUndefined();
			expect(item?.file_id).toBe("AgACAgIAAxkFileOnly");
			expect(item?.file_unique_id).toBe("AQADAgATqFileOnly");
		});

		it("handles media item with both URL and file_id (migrated)", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			const itemId = await t.mutation(api.media_items.upsertMediaItem, {
				url: "https://example.com/both.jpg",
				file_id: "AgACAgIAAxkBoth",
				file_unique_id: "AQADAgATqBoth",
				type: "image",
				post_id: postId,
			});

			const item = await t.query(api.media_items.getMediaItemById, {
				id: itemId,
			});
			expect(item?.url).toBe("https://example.com/both.jpg");
			expect(item?.file_id).toBe("AgACAgIAAxkBoth");
			expect(item?.file_unique_id).toBe("AQADAgATqBoth");
		});
	});

	describe("syncTelegramMediaItemsForPost cleanup", () => {
		it("removes legacy URL-only items during sync", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "carousel",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			// Create a legacy URL-only item (no file_unique_id)
			await t.mutation(api.media_items.upsertMediaItem, {
				url: "https://example.com/legacy.jpg",
				type: "image",
				post_id: postId,
			});

			// Verify legacy item exists
			const beforeSync = await t.query(api.media_items.getMediaItemsByPostId, {
				postId,
			});
			expect(beforeSync).toHaveLength(1);
			expect(beforeSync[0].file_unique_id).toBeUndefined();

			// Sync with new Telegram file_id items
			await t.mutation(api.media_items.syncTelegramMediaItemsForPost, {
				post_id: postId,
				media_items: [
					{ file_id: "AgAC1", file_unique_id: "unique1", type: "image" },
				],
			});

			// Legacy item should be removed, new item should exist
			const afterSync = await t.query(api.media_items.getMediaItemsByPostId, {
				postId,
			});
			expect(afterSync).toHaveLength(1);
			expect(afterSync[0].file_unique_id).toBe("unique1");
		});

		it("preserves migrated items with matching file_unique_id", async () => {
			const t = convexTest(schema, modules);

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "test_123",
				shortcode: "ABC123",
				display_url: "https://example.com/image.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123/",
				media_type: "image",
				users: [],
				timestamp: Math.floor(Date.now() / 1000),
			});

			// Create an already-migrated item
			await t.mutation(api.media_items.upsertMediaItem, {
				url: "https://example.com/migrated.jpg",
				file_id: "AgACOld",
				file_unique_id: "uniquePreserve",
				type: "image",
				width: 1080,
				height: 1080,
				post_id: postId,
			});

			// Sync with updated file_id but same file_unique_id
			await t.mutation(api.media_items.syncTelegramMediaItemsForPost, {
				post_id: postId,
				media_items: [
					{
						file_id: "AgACNew",
						file_unique_id: "uniquePreserve",
						type: "image",
					},
				],
			});

			const items = await t.query(api.media_items.getMediaItemsByPostId, {
				postId,
			});
			expect(items).toHaveLength(1);
			// file_id updated
			expect(items[0].file_id).toBe("AgACNew");
			// file_unique_id preserved (same)
			expect(items[0].file_unique_id).toBe("uniquePreserve");
		});
	});
});
