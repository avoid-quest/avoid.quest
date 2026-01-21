import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("users", () => {
	describe("getOrCreateUserInternal", () => {
		it("creates new user with to_be_scraped=true", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "newuser",
			});

			expect(user).not.toBeNull();
			expect(user?.username).toBe("newuser");
			expect(user?.to_be_scraped).toBe(true);
		});

		it("returns existing user on duplicate username", async () => {
			const t = convexTest(schema, modules);

			const first = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "existinguser",
			});

			const second = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "existinguser",
			});

			expect(first?._id).toBe(second?._id);
		});

		it("creates multiple users with different usernames", async () => {
			const t = convexTest(schema, modules);

			const user1 = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "user1",
			});

			const user2 = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "user2",
			});

			expect(user1?._id).not.toBe(user2?._id);
			expect(user1?.username).toBe("user1");
			expect(user2?.username).toBe("user2");
		});
	});

	describe("listToBeScrapedInternal", () => {
		it("returns empty array when no users", async () => {
			const t = convexTest(schema, modules);

			const users = await t.query(internal.users.listToBeScrapedInternal, {
				limit: 10,
			});

			expect(users).toEqual([]);
		});

		it("returns users marked for scraping", async () => {
			const t = convexTest(schema, modules);

			// Create user (defaults to to_be_scraped=true)
			await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "toscrape",
			});

			const users = await t.query(internal.users.listToBeScrapedInternal, {
				limit: 10,
			});

			expect(users).toHaveLength(1);
			expect(users[0].username).toBe("toscrape");
		});

		it("respects limit parameter", async () => {
			const t = convexTest(schema, modules);

			// Create 5 users
			for (let i = 0; i < 5; i++) {
				await t.mutation(internal.users.getOrCreateUserInternal, {
					username: `user${i}`,
				});
			}

			const users = await t.query(internal.users.listToBeScrapedInternal, {
				limit: 3,
			});

			expect(users).toHaveLength(3);
		});

		it("respects minIntervalMs filter", async () => {
			const t = convexTest(schema, modules);

			// Create user
			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "recentlyscraped",
			});

			// Update last_scraped_at to recent time
			await t.mutation(internal.users.updateLastScrapedAtInternal, {
				id: user!._id,
				lastScrapedAt: Date.now(),
			});

			// Should not return recently scraped user
			const users = await t.query(internal.users.listToBeScrapedInternal, {
				limit: 10,
				minIntervalMs: 30 * 60 * 1000, // 30 minutes
			});

			expect(
				users.find((u: Doc<"users">) => u.username === "recentlyscraped"),
			).toBeUndefined();
		});

		it("returns users scraped longer ago than minIntervalMs", async () => {
			const t = convexTest(schema, modules);

			// Create user
			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "oldscraped",
			});

			// Update last_scraped_at to 1 hour ago
			await t.mutation(internal.users.updateLastScrapedAtInternal, {
				id: user!._id,
				lastScrapedAt: Date.now() - 60 * 60 * 1000,
			});

			// Should return user scraped more than 30 min ago
			const users = await t.query(internal.users.listToBeScrapedInternal, {
				limit: 10,
				minIntervalMs: 30 * 60 * 1000, // 30 minutes
			});

			expect(
				users.find((u: Doc<"users">) => u.username === "oldscraped"),
			).toBeDefined();
		});

		it("returns users with no last_scraped_at when minIntervalMs is set", async () => {
			const t = convexTest(schema, modules);

			// Create user (no last_scraped_at)
			await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "neverscraped",
			});

			const users = await t.query(internal.users.listToBeScrapedInternal, {
				limit: 10,
				minIntervalMs: 30 * 60 * 1000,
			});

			expect(
				users.find((u: Doc<"users">) => u.username === "neverscraped"),
			).toBeDefined();
		});
	});

	describe("updateLastScrapedAtInternal", () => {
		it("updates last_scraped_at timestamp", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});

			const timestamp = Date.now();
			await t.mutation(internal.users.updateLastScrapedAtInternal, {
				id: user!._id,
				lastScrapedAt: timestamp,
			});

			// Verify the update by fetching directly
			const updatedUser = await t.run(async (ctx) => {
				return (await ctx.db.get(user!._id)) as Doc<"users"> | null;
			});

			expect(updatedUser?.last_scraped_at).toBe(timestamp);
		});

		it("can update timestamp multiple times", async () => {
			const t = convexTest(schema, modules);

			const user = await t.mutation(internal.users.getOrCreateUserInternal, {
				username: "testuser",
			});

			const firstTimestamp = Date.now();
			await t.mutation(internal.users.updateLastScrapedAtInternal, {
				id: user!._id,
				lastScrapedAt: firstTimestamp,
			});

			const secondTimestamp = Date.now() + 1000;
			await t.mutation(internal.users.updateLastScrapedAtInternal, {
				id: user!._id,
				lastScrapedAt: secondTimestamp,
			});

			const updatedUser = await t.run(async (ctx) => {
				return (await ctx.db.get(user!._id)) as Doc<"users"> | null;
			});

			expect(updatedUser?.last_scraped_at).toBe(secondTimestamp);
		});
	});
});
