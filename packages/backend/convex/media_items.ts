import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getMediaItems = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("media_items").collect(),
});

export const getMediaItemById = query({
  args: { id: v.id("media_items") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const getMediaItemsByPostId = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) =>
    await ctx.db
      .query("media_items")
      .withIndex("by_post_id", (q) => q.eq("post_id", postId))
      .collect(),
});

export const upsertMediaItem = mutation({
  args: {
    id: v.optional(v.id("media_items")),
    url: v.string(),
    type: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("thumbnail")
    ),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    post_id: v.id("posts"),
    legacy_post_id: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { id, url, type, width, height, post_id, legacy_post_id }
  ) => {
    if (id) {
      return await ctx.db.patch(id, {
        url,
        type,
        width,
        height,
        legacy_post_id,
      });
    }
    return await ctx.db.insert("media_items", {
      url,
      type,
      width,
      height,
      post_id,
      legacy_post_id,
    });
  },
});

export const deleteMediaItem = mutation({
  args: { id: v.id("media_items") },
  handler: async (ctx, { id }) => await ctx.db.delete(id),
});
