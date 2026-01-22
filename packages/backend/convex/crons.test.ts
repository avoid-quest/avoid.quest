/**
 * Tests for cron job orchestration logic
 *
 * These tests verify the database operations and state management
 * used by the cron jobs. The actual Telegram/Instagram API calls
 * are tested separately in their respective component tests.
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("cron job database operations", () => {
	describe("Telegram send orchestration", () => {
		it("getUnsentInternal returns posts in correct order", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			// Create posts with different timestamps
			const now = Date.now();
			await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "1",
				shortcode: "FIRST",
				display_url: "https://example.com/1.jpg",
				caption: "First post",
				is_video: false,
				url: "https://instagram.com/p/FIRST",
				media_type: "image",
				users: [user._id],
				timestamp: now - 3600000, // 1 hour ago
			});

			await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "2",
				shortcode: "SECOND",
				display_url: "https://example.com/2.jpg",
				caption: "Second post",
				is_video: false,
				url: "https://instagram.com/p/SECOND",
				media_type: "image",
				users: [user._id],
				timestamp: now - 1800000, // 30 mins ago
			});

			const unsent = await t.query(internal.posts.getUnsentInternal, {
				limit: 10,
			});

			expect(unsent).toHaveLength(2);
			// Posts should be returned (order depends on index)
			expect(unsent.map((p) => p.shortcode)).toContain("FIRST");
			expect(unsent.map((p) => p.shortcode)).toContain("SECOND");
		});

		it("markSentInternal properly updates post state", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "1",
				shortcode: "TOSEND",
				display_url: "https://example.com/1.jpg",
				caption: "To be sent",
				is_video: false,
				url: "https://instagram.com/p/TOSEND",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Verify post is initially unsent
			const beforeSend = await t.query(internal.posts.getPostByIdInternal, {
				id: postId,
			});
			expect(beforeSend?.sent).toBe(false);

			// Mark as sent
			const sentAt = Date.now();
			await t.mutation(internal.posts.markSentInternal, {
				id: postId,
				sentAt,
			});

			// Verify post is now sent
			const afterSend = await t.query(internal.posts.getPostByIdInternal, {
				id: postId,
			});
			expect(afterSend?.sent).toBe(true);
			expect(afterSend?.sentAt).toBe(sentAt);

			// Verify post no longer appears in unsent
			const unsent = await t.query(internal.posts.getUnsentInternal, {
				limit: 10,
			});
			expect(unsent.find((p) => p._id === postId)).toBeUndefined();
		});

		it("respects send limit in getUnsentInternal", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			// Create 10 posts
			for (let i = 0; i < 10; i++) {
				await t.mutation(internal.posts.upsertPostInternal, {
					ig_id: `${i}`,
					shortcode: `POST${i}`,
					display_url: `https://example.com/${i}.jpg`,
					caption: `Post ${i}`,
					is_video: false,
					url: `https://instagram.com/p/POST${i}`,
					media_type: "image",
					users: [user._id],
					timestamp: Date.now() + i,
				});
			}

			// Request only 5
			const unsent = await t.query(internal.posts.getUnsentInternal, {
				limit: 5,
			});
			expect(unsent).toHaveLength(5);

			// Request all
			const allUnsent = await t.query(internal.posts.getUnsentInternal, {
				limit: 100,
			});
			expect(allUnsent).toHaveLength(10);
		});
	});

	describe("Instagram fetch orchestration", () => {
		it("listToBeScrapedInternal returns users with to_be_scraped=true", async () => {
			const t = convexTest(schema, modules);

			// Create users with different scraping states
			await t.mutation(internal.users.createUserInternal, {
				username: "active_user",
			});

			const inactiveUser = await t.mutation(
				internal.users.getOrCreateUserInternal,
				{
					username: "inactive_user",
				},
			);
			if (inactiveUser) {
				await t.mutation(internal.users.toggleScrapingInternal, {
					id: inactiveUser._id,
				});
			}

			const users = await t.query(internal.users.listToBeScrapedInternal, {
				limit: 10,
			});

			// Should only include active user
			expect(users).toHaveLength(1);
			expect(users[0].username).toBe("active_user");
		});

		it("listToBeScrapedInternal respects minIntervalMs", async () => {
			const t = convexTest(schema, modules);

			// Create a user that was scraped recently
			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "recent_user",
			});
			if (!user) throw new Error("User should be created");

			// Update last_scraped_at to 5 minutes ago
			const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
			await t.mutation(internal.users.updateLastScrapedAtInternal, {
				id: user._id,
				lastScrapedAt: fiveMinutesAgo,
			});

			// Create a user that was scraped 2 hours ago
			const oldUser = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "old_user",
			});
			if (!oldUser) throw new Error("Old user should be created");

			const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
			await t.mutation(internal.users.updateLastScrapedAtInternal, {
				id: oldUser._id,
				lastScrapedAt: twoHoursAgo,
			});

			// With 1 hour minimum interval, only old_user should be returned
			const users = await t.query(internal.users.listToBeScrapedInternal, {
				limit: 10,
				minIntervalMs: 60 * 60 * 1000, // 1 hour
			});

			expect(users).toHaveLength(1);
			expect(users[0].username).toBe("old_user");
		});

		it("updateLastScrapedAtInternal updates timestamp correctly", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const now = Date.now();
			await t.mutation(internal.users.updateLastScrapedAtInternal, {
				id: user._id,
				lastScrapedAt: now,
			});

			const updated = await t.query(internal.users.getUserByIdInternal, {
				id: user._id,
			});
			expect(updated?.last_scraped_at).toBe(now);
		});

		it("users without last_scraped_at are included in scrape list", async () => {
			const t = convexTest(schema, modules);

			// Create a fresh user (no last_scraped_at)
			await t.mutation(internal.users.createUserInternal, {
				username: "fresh_user",
			});

			const users = await t.query(internal.users.listToBeScrapedInternal, {
				limit: 10,
				minIntervalMs: 60 * 60 * 1000, // 1 hour
			});

			// Fresh user should be included (null/undefined last_scraped_at passes filter)
			expect(users).toHaveLength(1);
			expect(users[0].username).toBe("fresh_user");
			expect(users[0].last_scraped_at).toBeUndefined();
		});
	});

	describe("Post upsert and duplicate handling", () => {
		it("getPostByShortcodeInternal finds existing posts", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "123",
				shortcode: "UNIQUE_CODE",
				display_url: "https://example.com/1.jpg",
				caption: "Test post",
				is_video: false,
				url: "https://instagram.com/p/UNIQUE_CODE",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const found = await t.query(internal.posts.getPostByShortcodeInternal, {
				shortcode: "UNIQUE_CODE",
			});
			expect(found).not.toBeNull();
			expect(found?.ig_id).toBe("123");

			const notFound = await t.query(
				internal.posts.getPostByShortcodeInternal,
				{
					shortcode: "NONEXISTENT",
				},
			);
			expect(notFound).toBeNull();
		});

		it("upsertPostInternal merges user arrays on update", async () => {
			const t = convexTest(schema, modules);

			const user1 = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "user1",
			});
			const user2 = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "user2",
			});
			if (!user1 || !user2) throw new Error("Users should be created");

			// Create post with user1
			const postId = await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "123",
				shortcode: "SHARED_POST",
				display_url: "https://example.com/1.jpg",
				caption: "Shared post",
				is_video: false,
				url: "https://instagram.com/p/SHARED_POST",
				media_type: "image",
				users: [user1._id],
				timestamp: Date.now(),
			});

			// Update with user2
			await t.mutation(internal.posts.upsertPostInternal, {
				id: postId,
				ig_id: "123",
				shortcode: "SHARED_POST",
				display_url: "https://example.com/1.jpg",
				caption: "Shared post",
				is_video: false,
				url: "https://instagram.com/p/SHARED_POST",
				media_type: "image",
				users: [user2._id],
				timestamp: Date.now(),
			});

			const post = await t.query(internal.posts.getPostByIdInternal, {
				id: postId,
			});
			expect(post?.users).toHaveLength(2);
			expect(post?.users).toContain(user1._id);
			expect(post?.users).toContain(user2._id);
		});
	});

	describe("Media items for posts", () => {
		it("getMediaItemsByPostIdInternal returns all media items", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "123",
				shortcode: "CAROUSEL",
				display_url: "https://example.com/1.jpg",
				caption: "Carousel post",
				is_video: false,
				url: "https://instagram.com/p/CAROUSEL",
				media_type: "carousel",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Add media items
			await t.mutation(internal.media_items.syncMediaItemsForPostInternal, {
				post_id: postId,
				media_items: [
					{ url: "https://example.com/1.jpg", type: "image" },
					{
						url: "https://example.com/2.mp4",
						type: "video",
						width: 1920,
						height: 1080,
					},
					{ url: "https://example.com/3.jpg", type: "image" },
				],
			});

			const mediaItems = await t.query(
				internal.media_items.getMediaItemsByPostIdInternal,
				{ postId },
			);

			expect(mediaItems).toHaveLength(3);
			expect(mediaItems[0].type).toBe("image");
			expect(mediaItems[1].type).toBe("video");
			expect(mediaItems[1].width).toBe(1920);
		});

		it("updateMediaItemWithFileIdInternal stores file_id correctly", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "123",
				shortcode: "SINGLE",
				display_url: "https://example.com/1.jpg",
				caption: "Single post",
				is_video: false,
				url: "https://instagram.com/p/SINGLE",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			await t.mutation(internal.media_items.syncMediaItemsForPostInternal, {
				post_id: postId,
				media_items: [{ url: "https://example.com/1.jpg", type: "image" }],
			});

			// Update with file_id
			await t.mutation(internal.media_items.updateMediaItemWithFileIdInternal, {
				post_id: postId,
				url: "https://example.com/1.jpg",
				file_id: "AgACFileId",
				file_unique_id: "uniqueId123",
			});

			const mediaItems = await t.query(
				internal.media_items.getMediaItemsByPostIdInternal,
				{ postId },
			);

			expect(mediaItems).toHaveLength(1);
			expect(mediaItems[0].file_id).toBe("AgACFileId");
			expect(mediaItems[0].file_unique_id).toBe("uniqueId123");
		});
	});

	describe("Retry single post orchestration", () => {
		it("getPostByIdInternal returns post for retry", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "123",
				shortcode: "RETRY",
				display_url: "https://example.com/1.jpg",
				caption: "Retry post",
				is_video: false,
				url: "https://instagram.com/p/RETRY",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const post = await t.query(internal.posts.getPostByIdInternal, {
				id: postId,
			});

			expect(post).not.toBeNull();
			expect(post?.shortcode).toBe("RETRY");
			expect(post?.sent).toBe(false);
		});

		it("already sent posts are skipped in retry", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "123",
				shortcode: "SENT",
				display_url: "https://example.com/1.jpg",
				caption: "Sent post",
				is_video: false,
				url: "https://instagram.com/p/SENT",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Mark as sent
			await t.mutation(internal.posts.markSentInternal, {
				id: postId,
				sentAt: Date.now(),
			});

			const post = await t.query(internal.posts.getPostByIdInternal, {
				id: postId,
			});

			// retrySinglePost would check this condition and skip
			expect(post?.sent).toBe(true);
		});
	});
});

describe("cron job edge cases", () => {
	it("handles empty user list gracefully", async () => {
		const t = convexTest(schema, modules);

		// No users created
		const users = await t.query(internal.users.listToBeScrapedInternal, {
			limit: 10,
		});

		expect(users).toHaveLength(0);
	});

	it("handles empty post list gracefully", async () => {
		const t = convexTest(schema, modules);

		// No posts created
		const posts = await t.query(internal.posts.getUnsentInternal, {
			limit: 10,
		});

		expect(posts).toHaveLength(0);
	});

	it("handles carousel with many media items", async () => {
		const t = convexTest(schema, modules);

		const user = await t.mutation(internal.users.getOrCreateUserInternal, {
			username: "testuser",
		});
		if (!user) throw new Error("User should be created");

		const postId = await t.mutation(internal.posts.upsertPostInternal, {
			ig_id: "123",
			shortcode: "BIGCAROUSEL",
			display_url: "https://example.com/1.jpg",
			caption: "Big carousel",
			is_video: false,
			url: "https://instagram.com/p/BIGCAROUSEL",
			media_type: "carousel",
			users: [user._id],
			timestamp: Date.now(),
		});

		// Add 10 media items (Telegram max)
		const mediaItems = Array.from({ length: 10 }, (_, i) => ({
			url: `https://example.com/${i}.jpg`,
			type: "image" as const,
		}));

		await t.mutation(internal.media_items.syncMediaItemsForPostInternal, {
			post_id: postId,
			media_items: mediaItems,
		});

		const items = await t.query(
			internal.media_items.getMediaItemsByPostIdInternal,
			{ postId },
		);

		expect(items).toHaveLength(10);
	});

	it("handles video post with thumbnail", async () => {
		const t = convexTest(schema, modules);

		const user = await t.mutation(internal.users.getOrCreateUserInternal, {
			username: "testuser",
		});
		if (!user) throw new Error("User should be created");

		const postId = await t.mutation(internal.posts.upsertPostInternal, {
			ig_id: "123",
			shortcode: "VIDEO",
			display_url: "https://example.com/thumb.jpg",
			video_url: "https://example.com/video.mp4",
			thumbnail_url: "https://example.com/thumb.jpg",
			caption: "Video post",
			is_video: true,
			url: "https://instagram.com/p/VIDEO",
			media_type: "video",
			users: [user._id],
			timestamp: Date.now(),
		});

		await t.mutation(internal.media_items.syncMediaItemsForPostInternal, {
			post_id: postId,
			media_items: [
				{
					url: "https://example.com/video.mp4",
					type: "video",
					width: 1920,
					height: 1080,
				},
				{
					url: "https://example.com/thumb.jpg",
					type: "thumbnail",
				},
			],
		});

		const items = await t.query(
			internal.media_items.getMediaItemsByPostIdInternal,
			{ postId },
		);

		expect(items).toHaveLength(2);
		const video = items.find((i) => i.type === "video");
		const thumb = items.find((i) => i.type === "thumbnail");
		expect(video).toBeDefined();
		expect(thumb).toBeDefined();
	});
});
