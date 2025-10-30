import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getPosts = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) =>
    await ctx.db
      .query("posts")
      .withIndex("by_event_date")
      .order("desc")
      .take(limit ?? 10),
});

export type Identity<T> = { [P in keyof T]: T[P] };
export type Replace<T, K extends keyof T, TReplace> = Identity<
  Pick<T, Exclude<keyof T, K>> & {
    [P in K]: TReplace;
  }
>;

export const getPostById = query({
  args: { id: v.id("posts") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const getPostByShortcode = query({
  args: { shortcode: v.string() },
  handler: async (ctx, { shortcode }) =>
    await ctx.db
      .query("posts")
      .withIndex("by_shortcode", (q) => q.eq("shortcode", shortcode))
      .first(),
});

export const upsertPost = mutation({
  args: {
    id: v.optional(v.id("posts")),
    ig_id: v.string(),
    shortcode: v.string(),
    display_url: v.string(),
    video_url: v.optional(v.string()),
    thumbnail_url: v.optional(v.string()),
    caption: v.string(),
    is_video: v.boolean(),
    url: v.string(),
    media_type: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("carousel")
    ),
    users: v.array(v.id("users")),
    timestamp: v.number(),
    event_date: v.optional(v.number()),
    sent: v.boolean(),
    sentAt: v.optional(v.number()),
    legacy_id: v.optional(v.number()),
  },
  handler: async (
    ctx,
    {
      id,
      ig_id,
      shortcode,
      display_url,
      video_url,
      thumbnail_url,
      caption,
      is_video,
      url,
      media_type,
      users,
      timestamp,
      event_date,
      sent,
      sentAt,
      legacy_id,
    }
  ) => {
    if (id) {
      return await ctx.db.patch(id, {
        ig_id,
        shortcode,
        display_url,
        video_url,
        thumbnail_url,
        caption,
        is_video,
        url,
        media_type,
        users,
        timestamp,
        event_date,
        sent,
        sentAt,
        legacy_id,
      });
    }
    return await ctx.db.insert("posts", {
      ig_id,
      shortcode,
      display_url,
      video_url,
      thumbnail_url,
      caption,
      is_video,
      url,
      media_type,
      users,
      timestamp,
      event_date,
      sent,
      sentAt,
      legacy_id,
    });
  },
});

export const deletePost = mutation({
  args: { id: v.id("posts") },
  handler: async (ctx, { id }) => await ctx.db.delete(id),
});
