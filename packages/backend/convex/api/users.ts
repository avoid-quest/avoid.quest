/**
 * Public API for users - used by instarip web frontend
 */
import { v } from "convex/values";
import { components } from "../_generated/api";
import { query } from "../_generated/server";

/**
 * Get user by username
 */
export const getByUsername = query({
	args: { username: v.string() },
	handler: async (ctx, { username }) => {
		return await ctx.runQuery(components.instarip.users.getUserByUsername, {
			username,
		});
	},
});

/**
 * Get users with limit
 */
export const getUsers = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) => {
		return await ctx.runQuery(components.instarip.users.getUsersLimited, {
			limit,
		});
	},
});
