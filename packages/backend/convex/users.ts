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

const DEFAULT_TO_BE_SCRAPED_LIMIT = 100;

export const listToBeScraped = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) =>
    await ctx.db
      .query("users")
      .withIndex("by_to_be_scraped_last_scraped_at", (q) =>
        q.eq("to_be_scraped", true)
      )
      .order("asc")
      .take(limit ?? DEFAULT_TO_BE_SCRAPED_LIMIT),
});

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
    { id, username, profile_url, to_be_scraped, last_scraped_at }
  ) => {
    if (id) {
      await ctx.db.patch(id, {
        username,
        profile_url,
        to_be_scraped,
        last_scraped_at,
      });
      return id;
    }
    if (!username) {
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

export const deleteUser = mutation({
  args: { id: v.id("users") },
  handler: async (ctx, { id }) => await ctx.db.delete(id),
});
