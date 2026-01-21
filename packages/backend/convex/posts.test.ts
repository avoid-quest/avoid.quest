import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("posts", () => {
	describe("getUnsentInternal", () => {
		it("returns empty array when no posts", async () => {
			const t = convexTest(schema, modules);
			const posts = await t.query(internal.posts.getUnsentInternal, {
				limit: 10,
			});
			expect(posts).toEqual([]);
		});

		it("returns only unsent posts", async () => {
			const t = convexTest(schema, modules);

			// Create a user first
			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			// Create an unsent post
			await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "1",
				shortcode: "ABC123",
				display_url: "https://example.com/1.jpg",
				caption: "Test 1",
				is_video: false,
				url: "https://instagram.com/p/ABC123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const unsent = await t.query(internal.posts.getUnsentInternal, {
				limit: 10,
			});
			expect(unsent).toHaveLength(1);
			expect(unsent[0].shortcode).toBe("ABC123");
			expect(unsent[0].sent).toBe(false);
		});

		it("excludes sent posts", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			// Create a post
			const postId = await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "1",
				shortcode: "ABC123",
				display_url: "https://example.com/1.jpg",
				caption: "Test 1",
				is_video: false,
				url: "https://instagram.com/p/ABC123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Mark it as sent
			await t.mutation(internal.posts.markSentInternal, {
				id: postId,
				sentAt: Date.now(),
			});

			const unsent = await t.query(internal.posts.getUnsentInternal, {
				limit: 10,
			});
			expect(unsent).toHaveLength(0);
		});

		it("respects limit parameter", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			// Create 5 posts
			for (let i = 0; i < 5; i++) {
				await t.mutation(internal.posts.upsertPostInternal, {
					ig_id: `${i}`,
					shortcode: `POST${i}`,
					display_url: `https://example.com/${i}.jpg`,
					caption: `Test ${i}`,
					is_video: false,
					url: `https://instagram.com/p/POST${i}`,
					media_type: "image",
					users: [user._id],
					timestamp: Date.now() + i,
				});
			}

			const unsent = await t.query(internal.posts.getUnsentInternal, {
				limit: 3,
			});
			expect(unsent).toHaveLength(3);
		});
	});

	describe("markSentInternal", () => {
		it("marks post as sent with timestamp", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "1",
				shortcode: "ABC123",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/ABC123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const sentAt = Date.now();
			await t.mutation(internal.posts.markSentInternal, {
				id: postId,
				sentAt,
			});

			// Verify post is no longer in unsent
			const unsent = await t.query(internal.posts.getUnsentInternal, {
				limit: 10,
			});
			expect(unsent).toHaveLength(0);

			// Verify post has correct sentAt timestamp
			const post = await t.query(internal.posts.getPostByIdInternal, {
				id: postId,
			});
			expect(post?.sent).toBe(true);
			expect(post?.sentAt).toBe(sentAt);
		});

		it("throws error for non-existent post", async () => {
			const t = convexTest(schema, modules);

			// Use a fake ID - we need to create and delete a post to get a valid but non-existent ID format
			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "temp",
				shortcode: "TEMP",
				display_url: "https://example.com/temp.jpg",
				caption: "Temp",
				is_video: false,
				url: "https://instagram.com/p/TEMP",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Delete the post
			await t.run(async (ctx) => {
				await ctx.db.delete(postId);
			});

			// Try to mark deleted post as sent
			await expect(
				t.mutation(internal.posts.markSentInternal, {
					id: postId,
					sentAt: Date.now(),
				}),
			).rejects.toThrow();
		});
	});

	describe("getPostByShortcodeInternal", () => {
		it("returns post by shortcode", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "1",
				shortcode: "UNIQUE123",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/UNIQUE123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const post = await t.query(internal.posts.getPostByShortcodeInternal, {
				shortcode: "UNIQUE123",
			});

			expect(post).not.toBeNull();
			expect(post?.shortcode).toBe("UNIQUE123");
		});

		it("returns null for non-existent shortcode", async () => {
			const t = convexTest(schema, modules);

			const post = await t.query(internal.posts.getPostByShortcodeInternal, {
				shortcode: "NONEXISTENT",
			});

			expect(post).toBeNull();
		});
	});

	describe("upsertPostInternal", () => {
		it("creates new post with sent=false", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "1",
				shortcode: "NEW123",
				display_url: "https://example.com/1.jpg",
				caption: "New post",
				is_video: false,
				url: "https://instagram.com/p/NEW123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const post = await t.query(internal.posts.getPostByIdInternal, {
				id: postId,
			});
			expect(post?.sent).toBe(false);
			expect(post?.shortcode).toBe("NEW123");
		});

		it("updates existing post and merges users", async () => {
			const t = convexTest(schema, modules);

			const user1 = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "user1",
			});
			if (!user1) throw new Error("User1 should be created");
			const user2 = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "user2",
			});
			if (!user2) throw new Error("User2 should be created");

			// Create post with user1
			const postId = await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "1",
				shortcode: "MERGE123",
				display_url: "https://example.com/1.jpg",
				caption: "Original",
				is_video: false,
				url: "https://instagram.com/p/MERGE123",
				media_type: "image",
				users: [user1._id],
				timestamp: Date.now(),
			});

			// Update with user2
			await t.mutation(internal.posts.upsertPostInternal, {
				id: postId,
				ig_id: "1",
				shortcode: "MERGE123",
				display_url: "https://example.com/updated.jpg",
				caption: "Updated",
				is_video: false,
				url: "https://instagram.com/p/MERGE123",
				media_type: "image",
				users: [user2._id],
				timestamp: Date.now(),
			});

			const post = await t.query(internal.posts.getPostByIdInternal, {
				id: postId,
			});
			expect(post?.caption).toBe("Updated");
			expect(post?.users).toHaveLength(2);
			expect(post?.users).toContain(user1._id);
			expect(post?.users).toContain(user2._id);
		});

		it("handles video posts", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "1",
				shortcode: "VIDEO123",
				display_url: "https://example.com/thumb.jpg",
				video_url: "https://example.com/video.mp4",
				thumbnail_url: "https://example.com/thumb.jpg",
				caption: "Video post",
				is_video: true,
				url: "https://instagram.com/p/VIDEO123",
				media_type: "video",
				users: [user._id],
				timestamp: Date.now(),
			});

			const post = await t.query(internal.posts.getPostByIdInternal, {
				id: postId,
			});
			expect(post?.is_video).toBe(true);
			expect(post?.media_type).toBe("video");
			expect(post?.video_url).toBe("https://example.com/video.mp4");
		});

		it("handles carousel posts", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "1",
				shortcode: "CAROUSEL123",
				display_url: "https://example.com/1.jpg",
				caption: "Carousel post",
				is_video: false,
				url: "https://instagram.com/p/CAROUSEL123",
				media_type: "carousel",
				users: [user._id],
				timestamp: Date.now(),
			});

			const post = await t.query(internal.posts.getPostByIdInternal, {
				id: postId,
			});
			expect(post?.media_type).toBe("carousel");
		});

		it("handles event_date", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const eventDate = Date.now() + 86400000; // Tomorrow
			const postId = await t.mutation(internal.posts.upsertPostInternal, {
				ig_id: "1",
				shortcode: "EVENT123",
				display_url: "https://example.com/1.jpg",
				caption: "Event post",
				is_video: false,
				url: "https://instagram.com/p/EVENT123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
				event_date: eventDate,
			});

			const post = await t.query(internal.posts.getPostByIdInternal, {
				id: postId,
			});
			expect(post?.event_date).toBe(eventDate);
		});
	});
});
