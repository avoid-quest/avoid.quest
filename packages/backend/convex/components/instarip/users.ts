import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DEFAULT_TO_BE_SCRAPED_LIMIT = 100;

/**
 * Get all users ordered by username
 * @deprecated Use `getUsersPaginated` for large datasets or `getUsersLimited` for bounded queries.
 * This query loads all users into memory and may cause OOM errors with large user counts.
 */
export const getUsers = query({
	args: {},
	handler: async (ctx) =>
		await ctx.db.query("users").withIndex("by_username").order("asc").collect(),
});

const DEFAULT_USERS_LIMIT = 100;

/**
 * Get users with a configurable limit (bounded query to prevent OOM)
 */
export const getUsersLimited = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) =>
		await ctx.db
			.query("users")
			.withIndex("by_username")
			.order("asc")
			.take(limit ?? DEFAULT_USERS_LIMIT),
});

/**
 * Get users with pagination
 */
export const getUsersPaginated = query({
	args: { paginationOpts: paginationOptsValidator },
	returns: v.object({
		page: v.array(
			v.object({
				_id: v.id("users"),
				_creationTime: v.number(),
				username: v.string(),
				profile_url: v.optional(v.string()),
				to_be_scraped: v.boolean(),
				last_scraped_at: v.optional(v.number()),
			}),
		),
		isDone: v.boolean(),
		continueCursor: v.union(v.string(), v.null()),
	}),
	handler: async (ctx, { paginationOpts }) => {
		const result = await ctx.db
			.query("users")
			.withIndex("by_username")
			.order("asc")
			.paginate(paginationOpts);
		return {
			page: result.page,
			isDone: result.isDone,
			continueCursor: result.continueCursor,
		};
	},
});

/**
 * Get user by ID
 */
export const getUserById = query({
	args: { id: v.id("users") },
	handler: async (ctx, { id }) => await ctx.db.get(id),
});

/**
 * Get users by IDs
 */
export const getUsersByIds = query({
	args: { ids: v.array(v.id("users")) },
	handler: async (ctx, { ids }) =>
		await Promise.all(ids.map(async (id) => await ctx.db.get(id))),
});

/**
 * Get user by username
 */
export const getUserByUsername = query({
	args: { username: v.string() },
	handler: async (ctx, { username }) =>
		await ctx.db
			.query("users")
			.withIndex("by_username", (q) => q.eq("username", username))
			.first(),
});

/**
 * List users to be scraped (basic)
 */
export const listToBeScraped = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) =>
		await ctx.db
			.query("users")
			.withIndex("by_to_be_scraped_last_scraped_at", (q) =>
				q.eq("to_be_scraped", true),
			)
			.order("asc")
			.take(limit ?? DEFAULT_TO_BE_SCRAPED_LIMIT),
});

/**
 * List users to be scraped with interval filtering
 * Filters out users scraped recently (within minIntervalMs)
 */
export const listToBeScrapedWithInterval = query({
	args: {
		limit: v.number(),
		minIntervalMs: v.optional(v.number()),
	},
	handler: async (ctx, { limit, minIntervalMs }) => {
		const users = await ctx.db
			.query("users")
			.withIndex("by_to_be_scraped_last_scraped_at", (q) =>
				q.eq("to_be_scraped", true),
			)
			.order("asc")
			.take(limit * 2); // Fetch extra to filter

		// Filter out recently scraped users if minIntervalMs is provided
		if (minIntervalMs) {
			const cutoff = Date.now() - minIntervalMs;
			const filtered = users.filter(
				(u) => !u.last_scraped_at || u.last_scraped_at < cutoff,
			);
			return filtered.slice(0, limit);
		}

		return users.slice(0, limit);
	},
});

/**
 * Upsert a user
 */
export const upsertUser = mutation({
	args: {
		id: v.optional(v.id("users")),
		username: v.optional(v.string()),
		profile_url: v.optional(v.string()),
		to_be_scraped: v.boolean(),
		last_scraped_at: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{ id, username, profile_url, to_be_scraped, last_scraped_at },
	) => {
		if (id) {
			// Only update fields that are explicitly provided (not undefined)
			// Never overwrite username with empty string
			const patchData: {
				profile_url?: string;
				to_be_scraped: boolean;
				last_scraped_at?: number;
				username?: string;
			} = {
				to_be_scraped,
			};

			if (username !== undefined && username !== "") {
				patchData.username = username;
			}
			if (profile_url !== undefined) {
				patchData.profile_url = profile_url;
			}
			if (last_scraped_at !== undefined) {
				patchData.last_scraped_at = last_scraped_at;
			}

			await ctx.db.patch(id, patchData);
			return id;
		}
		if (!username || username === "") {
			throw new Error("Username is required");
		}
		return await ctx.db.insert("users", {
			username,
			profile_url,
			to_be_scraped,
			last_scraped_at,
		});
	},
});

/**
 * Delete a user
 */
export const deleteUser = mutation({
	args: { id: v.id("users") },
	handler: async (ctx, { id }) => await ctx.db.delete(id),
});

/**
 * Get or create a user by username
 */
export const getOrCreateUser = mutation({
	args: { username: v.string() },
	handler: async (ctx, { username }) => {
		const existing = await ctx.db
			.query("users")
			.withIndex("by_username", (q) => q.eq("username", username))
			.first();

		if (existing) {
			return existing;
		}

		const id = await ctx.db.insert("users", {
			username,
			to_be_scraped: true,
		});

		return await ctx.db.get(id);
	},
});

/**
 * Update user's last_scraped_at timestamp
 */
export const updateLastScrapedAt = mutation({
	args: { id: v.id("users"), lastScrapedAt: v.number() },
	handler: async (ctx, { id, lastScrapedAt }) => {
		await ctx.db.patch(id, { last_scraped_at: lastScrapedAt });
	},
});

/**
 * Toggle user's to_be_scraped status
 */
export const toggleScraping = mutation({
	args: { id: v.id("users") },
	handler: async (ctx, { id }) => {
		const user = await ctx.db.get(id);
		if (!user) throw new Error("User not found");
		await ctx.db.patch(id, { to_be_scraped: !user.to_be_scraped });
	},
});

/**
 * Create a new user
 */
export const createUser = mutation({
	args: { username: v.string() },
	handler: async (ctx, { username }) => {
		const existing = await ctx.db
			.query("users")
			.withIndex("by_username", (q) => q.eq("username", username))
			.first();

		if (existing) {
			throw new Error(`User @${username} already exists`);
		}

		return await ctx.db.insert("users", {
			username,
			to_be_scraped: true,
		});
	},
});

/**
 * Update username
 */
export const updateUsername = mutation({
	args: { id: v.id("users"), username: v.string() },
	handler: async (ctx, { id, username }) => {
		const existing = await ctx.db
			.query("users")
			.withIndex("by_username", (q) => q.eq("username", username))
			.first();

		if (existing && existing._id !== id) {
			throw new Error(`User @${username} already exists`);
		}

		await ctx.db.patch(id, { username });
	},
});
