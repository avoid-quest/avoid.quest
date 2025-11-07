import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

export const getUsers = query({
  args: {},
  handler: async (ctx) =>
    await ctx.db.query("users").withIndex("by_username").order("asc").collect(),
});

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
      })
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

export const deleteUser = mutation({
  args: { id: v.id("users") },
  handler: async (ctx, { id }) => await ctx.db.delete(id),
});
