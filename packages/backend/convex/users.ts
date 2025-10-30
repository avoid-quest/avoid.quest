import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getUsers = query({
  args: {},
  handler: async (ctx) =>
    await ctx.db.query("users").withIndex("by_username").order("asc").collect(),
});

export const getUserById = query({
  args: { id: v.id("users") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const getUsersByIds = query({
  args: { ids: v.array(v.id("users")) },
  handler: async (ctx, { ids }) =>
    await Promise.all(ids.map(async (id) => await ctx.db.get(id))),
});

export const getUserByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) =>
    await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .first(),
});

export const upsertUser = mutation({
  args: {
    id: v.optional(v.id("users")),
    username: v.string(),
    profile_url: v.optional(v.string()),
    to_be_scraped: v.boolean(),
    last_scraped_at: v.optional(v.number()),
    legacy_id: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { id, username, profile_url, to_be_scraped, last_scraped_at, legacy_id }
  ) => {
    if (id) {
      return await ctx.db.patch(id, {
        username,
        profile_url,
        to_be_scraped,
        last_scraped_at,
        legacy_id,
      });
    }
    return await ctx.db.insert("users", {
      username,
      profile_url,
      to_be_scraped,
      last_scraped_at,
      legacy_id,
    });
  },
});

export const deleteUser = mutation({
  args: { id: v.id("users") },
  handler: async (ctx, { id }) => await ctx.db.delete(id),
});
