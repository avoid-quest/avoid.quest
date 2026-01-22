/**
 * Session storage for grammY bot
 * Provides CRUD operations for bot sessions using Convex database
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Get session data by key (chat ID)
 */
export const getSession = internalQuery({
	args: { key: v.string() },
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, { key }) => {
		const session = await ctx.db
			.query("bot_sessions")
			.withIndex("by_key", (q) => q.eq("key", key))
			.first();
		return session?.data ?? null;
	},
});

/**
 * Set session data for a key (chat ID)
 * Creates new session if doesn't exist, updates if it does
 */
export const setSession = internalMutation({
	args: {
		key: v.string(),
		data: v.string(),
	},
	handler: async (ctx, { key, data }) => {
		const existing = await ctx.db
			.query("bot_sessions")
			.withIndex("by_key", (q) => q.eq("key", key))
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, { data });
		} else {
			await ctx.db.insert("bot_sessions", { key, data });
		}
	},
});

/**
 * Delete session by key (chat ID)
 */
export const deleteSession = internalMutation({
	args: { key: v.string() },
	handler: async (ctx, { key }) => {
		const session = await ctx.db
			.query("bot_sessions")
			.withIndex("by_key", (q) => q.eq("key", key))
			.first();

		if (session) {
			await ctx.db.delete(session._id);
		}
	},
});
