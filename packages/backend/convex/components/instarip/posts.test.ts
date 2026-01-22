import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("posts", () => {
	describe("getUnsent", () => {
		it("returns empty array when no posts", async () => {
			const t = convexTest(schema, modules);
			const posts = await t.query(api.posts.getUnsent, {
				limit: 10,
			});
			expect(posts).toEqual([]);
		});

		it("returns only unsent posts", async () => {
			const t = convexTest(schema, modules);

			// Create a user first
			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			// Create an unsent post
			await t.mutation(api.posts.upsertPost, {
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

			const unsent = await t.query(api.posts.getUnsent, {
				limit: 10,
			});
			expect(unsent).toHaveLength(1);
			expect(unsent[0].shortcode).toBe("ABC123");
			expect(unsent[0].status).toBe("pending");
		});

		it("excludes sent posts", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			// Create a post
			const postId = await t.mutation(api.posts.upsertPost, {
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

			// Claim and mark it as sent
			await t.mutation(api.posts.claimForSending, { id: postId });
			await t.mutation(api.posts.markSent, {
				id: postId,
				sentAt: Date.now(),
			});

			const unsent = await t.query(api.posts.getUnsent, {
				limit: 10,
			});
			expect(unsent).toHaveLength(0);
		});

		it("respects limit parameter", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			// Create 5 posts
			for (let i = 0; i < 5; i++) {
				await t.mutation(api.posts.upsertPost, {
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

			const unsent = await t.query(api.posts.getUnsent, {
				limit: 3,
			});
			expect(unsent).toHaveLength(3);
		});
	});

	describe("markSent", () => {
		it("marks post as sent with timestamp", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
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

			// Claim the post first (required before markSent)
			await t.mutation(api.posts.claimForSending, { id: postId });

			const sentAt = Date.now();
			await t.mutation(api.posts.markSent, {
				id: postId,
				sentAt,
			});

			// Verify post is no longer in unsent
			const unsent = await t.query(api.posts.getUnsent, {
				limit: 10,
			});
			expect(unsent).toHaveLength(0);

			// Verify post has correct sentAt timestamp
			const post = await t.query(api.posts.getPostById, {
				id: postId,
			});
			expect(post?.status).toBe("sent");
			expect(post?.sentAt).toBe(sentAt);
		});

		it("throws error for non-existent post", async () => {
			const t = convexTest(schema, modules);

			// Use a fake ID - we need to create and delete a post to get a valid but non-existent ID format
			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
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
			await t.mutation(api.posts.deletePost, { id: postId });

			// Try to mark deleted post as sent
			await expect(
				t.mutation(api.posts.markSent, {
					id: postId,
					sentAt: Date.now(),
				}),
			).rejects.toThrow();
		});

		it("throws error when post is not in sending state", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "PENDING123",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/PENDING123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Try to mark as sent without claiming first (post is in "pending" state)
			await expect(
				t.mutation(api.posts.markSent, {
					id: postId,
					sentAt: Date.now(),
				}),
			).rejects.toThrow(
				'Cannot mark as sent: expected "sending", got "pending"',
			);
		});
	});

	describe("getPostByShortcode", () => {
		it("returns post by shortcode", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			await t.mutation(api.posts.upsertPost, {
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

			const post = await t.query(api.posts.getPostByShortcode, {
				shortcode: "UNIQUE123",
			});

			expect(post).not.toBeNull();
			expect(post?.shortcode).toBe("UNIQUE123");
		});

		it("returns null for non-existent shortcode", async () => {
			const t = convexTest(schema, modules);

			const post = await t.query(api.posts.getPostByShortcode, {
				shortcode: "NONEXISTENT",
			});

			expect(post).toBeNull();
		});
	});

	describe("upsertPost", () => {
		it("creates new post with sent=false", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
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

			const post = await t.query(api.posts.getPostById, {
				id: postId,
			});
			expect(post?.status).toBe("pending");
			expect(post?.shortcode).toBe("NEW123");
		});

		it("updates existing post and merges users", async () => {
			const t = convexTest(schema, modules);

			const user1 = await t.mutation(api.users.getOrCreateUser, {
				username: "user1",
			});
			if (!user1) throw new Error("User1 should be created");
			const user2 = await t.mutation(api.users.getOrCreateUser, {
				username: "user2",
			});
			if (!user2) throw new Error("User2 should be created");

			// Create post with user1
			const postId = await t.mutation(api.posts.upsertPost, {
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
			await t.mutation(api.posts.upsertPost, {
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

			const post = await t.query(api.posts.getPostById, {
				id: postId,
			});
			expect(post?.caption).toBe("Updated");
			expect(post?.users).toHaveLength(2);
			expect(post?.users).toContain(user1._id);
			expect(post?.users).toContain(user2._id);
		});

		it("handles video posts", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
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

			const post = await t.query(api.posts.getPostById, {
				id: postId,
			});
			expect(post?.is_video).toBe(true);
			expect(post?.media_type).toBe("video");
			expect(post?.video_url).toBe("https://example.com/video.mp4");
		});

		it("handles carousel posts", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
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

			const post = await t.query(api.posts.getPostById, {
				id: postId,
			});
			expect(post?.media_type).toBe("carousel");
		});

		it("handles event_date", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const eventDate = Date.now() + 86400000; // Tomorrow
			const postId = await t.mutation(api.posts.upsertPost, {
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

			const post = await t.query(api.posts.getPostById, {
				id: postId,
			});
			expect(post?.event_date).toBe(eventDate);
		});

		it("throws error when updating with non-existent ID", async () => {
			const t = convexTest(schema, modules);

			// Create and delete a post to get a valid but non-existent ID format
			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
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

			await t.mutation(api.posts.deletePost, { id: postId });

			// Try to update a non-existent post
			await expect(
				t.mutation(api.posts.upsertPost, {
					id: postId,
					ig_id: "updated",
					shortcode: "UPDATED",
					display_url: "https://example.com/updated.jpg",
					caption: "Updated",
					is_video: false,
					url: "https://instagram.com/p/UPDATED",
					media_type: "image",
					users: [user._id],
					timestamp: Date.now(),
				}),
			).rejects.toThrow(`Post with id ${postId} not found`);
		});
	});

	describe("claimForSending", () => {
		it("returns true when claiming unclaimed post", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "CLAIM123",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/CLAIM123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const claimed = await t.mutation(api.posts.claimForSending, {
				id: postId,
			});
			expect(claimed).toBe(true);

			const post = await t.query(api.posts.getPostById, { id: postId });
			expect(post?.status).toBe("sending");
		});

		it("returns false for already claimed post", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "CLAIM123",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/CLAIM123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// First claim succeeds
			await t.mutation(api.posts.claimForSending, { id: postId });

			// Second claim fails
			const secondClaim = await t.mutation(api.posts.claimForSending, {
				id: postId,
			});
			expect(secondClaim).toBe(false);
		});

		it("returns false for sent post", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "CLAIM123",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/CLAIM123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Claim first, then mark as sent
			await t.mutation(api.posts.claimForSending, { id: postId });
			await t.mutation(api.posts.markSent, { id: postId, sentAt: Date.now() });

			const claimed = await t.mutation(api.posts.claimForSending, {
				id: postId,
			});
			expect(claimed).toBe(false);
		});

		it("returns false for non-existent post", async () => {
			const t = convexTest(schema, modules);

			// Create and delete a post to get a valid but non-existent ID format
			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
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

			await t.mutation(api.posts.deletePost, { id: postId });

			const claimed = await t.mutation(api.posts.claimForSending, {
				id: postId,
			});
			expect(claimed).toBe(false);
		});
	});

	describe("clearSending", () => {
		it("clears the sending flag", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "CLEAR123",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/CLEAR123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			await t.mutation(api.posts.claimForSending, { id: postId });
			await t.mutation(api.posts.clearSending, { id: postId });

			const post = await t.query(api.posts.getPostById, { id: postId });
			expect(post?.status).toBe("pending");
		});

		it("is idempotent for pending state (no-op)", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "IDEMPOTENT1",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/IDEMPOTENT1",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Post is in "pending" state, clearSending should be a no-op
			await t.mutation(api.posts.clearSending, { id: postId });

			const post = await t.query(api.posts.getPostById, { id: postId });
			expect(post?.status).toBe("pending");
		});

		it("is idempotent for sent state (no-op)", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "IDEMPOTENT2",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/IDEMPOTENT2",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Claim and mark as sent
			await t.mutation(api.posts.claimForSending, { id: postId });
			await t.mutation(api.posts.markSent, { id: postId, sentAt: Date.now() });

			// Post is in "sent" state, clearSending should be a no-op
			await t.mutation(api.posts.clearSending, { id: postId });

			const post = await t.query(api.posts.getPostById, { id: postId });
			expect(post?.status).toBe("sent");
		});

		it("is idempotent for failed state (no-op)", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "IDEMPOTENT3",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/IDEMPOTENT3",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Mark as failed
			await t.mutation(api.posts.markSendFailed, { id: postId });

			// Post is in "failed" state, clearSending should be a no-op
			await t.mutation(api.posts.clearSending, { id: postId });

			const post = await t.query(api.posts.getPostById, { id: postId });
			expect(post?.status).toBe("failed");
		});
	});

	describe("markSendFailed", () => {
		it("transitions post to failed status", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "FAIL123",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/FAIL123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// First claim the post (sets status to "sending")
			await t.mutation(api.posts.claimForSending, { id: postId });

			// Mark as failed
			await t.mutation(api.posts.markSendFailed, { id: postId });

			const post = await t.query(api.posts.getPostById, { id: postId });
			expect(post?.status).toBe("failed");
		});

		it("claimForSending returns false for permanently failed post", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "PERMFAIL",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/PERMFAIL",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Mark as permanently failed
			await t.mutation(api.posts.markSendFailed, { id: postId });

			// Try to claim - should return false
			const claimed = await t.mutation(api.posts.claimForSending, {
				id: postId,
			});
			expect(claimed).toBe(false);
		});

		it("handles non-existent post silently (no-op)", async () => {
			const t = convexTest(schema, modules);

			// Create and delete a post to get a valid but non-existent ID format
			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
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

			await t.mutation(api.posts.deletePost, { id: postId });

			// markSendFailed should not throw for non-existent post
			await expect(
				t.mutation(api.posts.markSendFailed, { id: postId }),
			).resolves.toBeNull();
		});

		it("throws error when trying to mark sent post as failed", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "SENTFAIL",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/SENTFAIL",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Claim and mark as sent
			await t.mutation(api.posts.claimForSending, { id: postId });
			await t.mutation(api.posts.markSent, { id: postId, sentAt: Date.now() });

			// Try to mark as failed - should throw
			await expect(
				t.mutation(api.posts.markSendFailed, { id: postId }),
			).rejects.toThrow(
				`Cannot mark as failed: post "${postId}" has already been sent`,
			);
		});

		it("is idempotent for already failed post (no-op)", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "DOUBLEFAIL",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/DOUBLEFAIL",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Mark as failed twice
			await t.mutation(api.posts.markSendFailed, { id: postId });
			await t.mutation(api.posts.markSendFailed, { id: postId });

			const post = await t.query(api.posts.getPostById, { id: postId });
			expect(post?.status).toBe("failed");
		});
	});

	describe("incrementRetryCount", () => {
		it("increments retry count from 0", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "RETRY123",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/RETRY123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const newCount = await t.mutation(api.posts.incrementRetryCount, {
				id: postId,
			});
			expect(newCount).toBe(1);

			const post = await t.query(api.posts.getPostById, { id: postId });
			expect(post?.retry_count).toBe(1);
		});

		it("increments existing retry count", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "RETRYINC",
				display_url: "https://example.com/1.jpg",
				caption: "Test",
				is_video: false,
				url: "https://instagram.com/p/RETRYINC",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Increment twice
			await t.mutation(api.posts.incrementRetryCount, { id: postId });
			const secondCount = await t.mutation(api.posts.incrementRetryCount, {
				id: postId,
			});
			expect(secondCount).toBe(2);

			const post = await t.query(api.posts.getPostById, { id: postId });
			expect(post?.retry_count).toBe(2);
		});

		it("returns 0 for non-existent post", async () => {
			const t = convexTest(schema, modules);

			// Create and delete a post to get a valid but non-existent ID format
			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			const postId = await t.mutation(api.posts.upsertPost, {
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

			await t.mutation(api.posts.deletePost, { id: postId });

			const count = await t.mutation(api.posts.incrementRetryCount, {
				id: postId,
			});
			expect(count).toBe(0);
		});
	});

	describe("getUnsent with send_failed", () => {
		it("excludes send_failed posts", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			// Create two posts
			const failedPostId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "FAILED",
				display_url: "https://example.com/1.jpg",
				caption: "Failed post",
				is_video: false,
				url: "https://instagram.com/p/FAILED",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			await t.mutation(api.posts.upsertPost, {
				ig_id: "2",
				shortcode: "NORMAL",
				display_url: "https://example.com/2.jpg",
				caption: "Normal post",
				is_video: false,
				url: "https://instagram.com/p/NORMAL",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now() + 1,
			});

			// Mark first post as failed
			await t.mutation(api.posts.markSendFailed, { id: failedPostId });

			// Get unsent should only return the normal post
			const unsent = await t.query(api.posts.getUnsent, { limit: 10 });
			expect(unsent).toHaveLength(1);
			expect(unsent[0].shortcode).toBe("NORMAL");
		});
	});

	describe("getBackfillStats", () => {
		it("returns zeros for empty database", async () => {
			const t = convexTest(schema, modules);

			const stats = await t.query(api.posts.getBackfillStats, {});

			expect(stats.totalSent).toBe(0);
			expect(stats.withFileIds).toBe(0);
			expect(stats.needsBackfill).toBe(0);
		});

		it("returns zeros when no sent posts", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			// Create unsent post
			await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "UNSENT123",
				display_url: "https://example.com/1.jpg",
				caption: "Unsent post",
				is_video: false,
				url: "https://instagram.com/p/UNSENT123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			const stats = await t.query(api.posts.getBackfillStats, {});

			expect(stats.totalSent).toBe(0);
			expect(stats.withFileIds).toBe(0);
			expect(stats.needsBackfill).toBe(0);
		});

		it("counts posts with all telegram_file as withFileIds", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			// Create sent post
			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "SENT123",
				display_url: "https://example.com/1.jpg",
				caption: "Sent post",
				is_video: false,
				url: "https://instagram.com/p/SENT123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Claim and mark as sent
			await t.mutation(api.posts.claimForSending, { id: postId });
			await t.mutation(api.posts.markSent, { id: postId, sentAt: Date.now() });

			// Create media item with telegram_file
			await t.mutation(api.mediaItems.upsertMediaItem, {
				post_id: postId,
				type: "image",
				telegram_file: {
					file_id: "test_file_id",
					file_unique_id: "test_unique_id",
				},
			});

			const stats = await t.query(api.posts.getBackfillStats, {});

			expect(stats.totalSent).toBe(1);
			expect(stats.withFileIds).toBe(1);
			expect(stats.needsBackfill).toBe(0);
		});

		it("counts posts with missing telegram_file as needsBackfill", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			// Create sent post
			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "BACKFILL123",
				display_url: "https://example.com/1.jpg",
				caption: "Backfill needed post",
				is_video: false,
				url: "https://instagram.com/p/BACKFILL123",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});

			// Claim and mark as sent
			await t.mutation(api.posts.claimForSending, { id: postId });
			await t.mutation(api.posts.markSent, { id: postId, sentAt: Date.now() });

			// Create media item WITHOUT telegram_file
			await t.mutation(api.mediaItems.upsertMediaItem, {
				post_id: postId,
				type: "image",
			});

			const stats = await t.query(api.posts.getBackfillStats, {});

			expect(stats.totalSent).toBe(1);
			expect(stats.withFileIds).toBe(0);
			expect(stats.needsBackfill).toBe(1);
		});

		it("handles mixed scenarios correctly", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			// Post 1: Sent with telegram_file
			const post1Id = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "COMPLETE1",
				display_url: "https://example.com/1.jpg",
				caption: "Complete post 1",
				is_video: false,
				url: "https://instagram.com/p/COMPLETE1",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});
			await t.mutation(api.posts.claimForSending, { id: post1Id });
			await t.mutation(api.posts.markSent, { id: post1Id, sentAt: Date.now() });
			await t.mutation(api.mediaItems.upsertMediaItem, {
				post_id: post1Id,
				type: "image",
				telegram_file: {
					file_id: "file_1",
					file_unique_id: "unique_1",
				},
			});

			// Post 2: Sent with all telegram_file
			const post2Id = await t.mutation(api.posts.upsertPost, {
				ig_id: "2",
				shortcode: "COMPLETE2",
				display_url: "https://example.com/2.jpg",
				caption: "Complete post 2",
				is_video: false,
				url: "https://instagram.com/p/COMPLETE2",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now() + 1,
			});
			await t.mutation(api.posts.claimForSending, { id: post2Id });
			await t.mutation(api.posts.markSent, { id: post2Id, sentAt: Date.now() });
			await t.mutation(api.mediaItems.upsertMediaItem, {
				post_id: post2Id,
				type: "image",
				telegram_file: {
					file_id: "file_2",
					file_unique_id: "unique_2",
				},
			});

			// Post 3: Sent needing backfill
			const post3Id = await t.mutation(api.posts.upsertPost, {
				ig_id: "3",
				shortcode: "NEEDSBACKFILL",
				display_url: "https://example.com/3.jpg",
				caption: "Needs backfill",
				is_video: false,
				url: "https://instagram.com/p/NEEDSBACKFILL",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now() + 2,
			});
			await t.mutation(api.posts.claimForSending, { id: post3Id });
			await t.mutation(api.posts.markSent, { id: post3Id, sentAt: Date.now() });
			await t.mutation(api.mediaItems.upsertMediaItem, {
				post_id: post3Id,
				type: "image",
				// No telegram_file
			});

			// Post 4: Unsent (should not be counted)
			await t.mutation(api.posts.upsertPost, {
				ig_id: "4",
				shortcode: "UNSENT",
				display_url: "https://example.com/4.jpg",
				caption: "Unsent post",
				is_video: false,
				url: "https://instagram.com/p/UNSENT",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now() + 3,
			});

			const stats = await t.query(api.posts.getBackfillStats, {});

			expect(stats.totalSent).toBe(3);
			expect(stats.withFileIds).toBe(2);
			expect(stats.needsBackfill).toBe(1);
		});

		it("handles sent posts with no media items", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(api.users.getOrCreateUser, {
				username: "testuser",
			});
			if (!user) throw new Error("User should be created");

			// Create sent post without media items
			const postId = await t.mutation(api.posts.upsertPost, {
				ig_id: "1",
				shortcode: "NOMEDIA",
				display_url: "https://example.com/1.jpg",
				caption: "No media items",
				is_video: false,
				url: "https://instagram.com/p/NOMEDIA",
				media_type: "image",
				users: [user._id],
				timestamp: Date.now(),
			});
			// Claim and mark as sent
			await t.mutation(api.posts.claimForSending, { id: postId });
			await t.mutation(api.posts.markSent, { id: postId, sentAt: Date.now() });

			const stats = await t.query(api.posts.getBackfillStats, {});

			// Post with no media items should be counted as totalSent
			// but not counted in withFileIds or needsBackfill
			expect(stats.totalSent).toBe(1);
			expect(stats.withFileIds).toBe(0);
			expect(stats.needsBackfill).toBe(0);
		});
	});
});
