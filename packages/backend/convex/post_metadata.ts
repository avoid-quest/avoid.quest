import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const getPostMetadata = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    return await ctx.db
      .query("post_metadata")
      .withIndex("by_post_id", (q) => q.eq("post_id", postId))
      .first();
  },
});

export const getPostsWithMetadata = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);

    const postsWithMetadata = await Promise.all(
      posts.map(async (post) => {
        const metadata = post.metadata_id
          ? await ctx.db.get(post.metadata_id)
          : null;
        return { ...post, metadata };
      })
    );

    return postsWithMetadata;
  },
});

export const getHighConfidenceEvents = query({
  args: { threshold: v.number(), limit: v.number() },
  handler: async (ctx, { threshold, limit }) => {
    return await ctx.db
      .query("post_metadata")
      .withIndex("by_event_score")
      .filter((q) => q.gt(q.field("event_score"), threshold))
      .order("desc")
      .take(limit);
  },
});

export const getUpcomingEvents = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    return await ctx.db
      .query("post_metadata")
      .withIndex("by_event_date_start")
      .filter((q) => q.gte(q.field("event_date_start"), now))
      .order("asc")
      .take(limit);
  },
});

export const getProcessingStats = query({
  args: {},
  handler: async (ctx) => {
    const allMetadata = await ctx.db.query("post_metadata").collect();
    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total: allMetadata.length,
    };

    for (const metadata of allMetadata) {
      stats[metadata.processing_status]++;
    }

    return stats;
  },
});

export const getFailedExtractions = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query("post_metadata")
      .withIndex("by_processing_status", (q) =>
        q.eq("processing_status", "failed")
      )
      .order("desc")
      .take(limit);
  },
});

export const getBacklogCount = query({
  args: {},
  handler: async (ctx) => {
    const postsWithoutMetadata = await ctx.db
      .query("posts")
      .filter((q) => q.eq(q.field("metadata_id"), undefined))
      .collect();
    return postsWithoutMetadata.length;
  },
});

export const getExtractionThread = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const metadata = await ctx.db
      .query("post_metadata")
      .withIndex("by_post_id", (q) => q.eq("post_id", postId))
      .first();

    if (!metadata || !metadata.agent_thread_id) {
      return null;
    }

    // Note: This would need to query the agent thread messages table
    // The exact implementation depends on how @convex-dev/agent stores threads
    // For now, return the thread ID so it can be queried separately
    return {
      threadId: metadata.agent_thread_id,
      metadataId: metadata._id,
    };
  },
});

// Admin Mutations

export const reprocessPostMetadata = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    // This will be called from the workflow trigger
    // For now, just mark as pending for reprocessing
    const metadata = await ctx.db
      .query("post_metadata")
      .withIndex("by_post_id", (q) => q.eq("post_id", postId))
      .first();

    if (metadata) {
      await ctx.db.patch(metadata._id, {
        processing_status: "pending",
        processing_error: undefined,
      });
      return metadata._id;
    }

    // Create new metadata record if it doesn't exist
    return await ctx.db.insert("post_metadata", {
      post_id: postId,
      event_score: 0,
      processing_status: "pending",
      extraction_version: 1,
    });
  },
});

export const batchReprocessMetadata = mutation({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const postsWithoutMetadata = await ctx.db
      .query("posts")
      .filter((q) => q.eq(q.field("metadata_id"), undefined))
      .take(limit);

    const metadataIds: Id<"post_metadata">[] = [];

    for (const post of postsWithoutMetadata) {
      const metadataId = await ctx.db.insert("post_metadata", {
        post_id: post._id,
        event_score: 0,
        processing_status: "pending",
        extraction_version: 1,
      });
      metadataIds.push(metadataId);
    }

    return metadataIds;
  },
});

export const clearMetadata = mutation({
  args: { metadataId: v.id("post_metadata") },
  handler: async (ctx, { metadataId }) => {
    const metadata = await ctx.db.get(metadataId);
    if (metadata) {
      // Remove reference from post
      await ctx.db.patch(metadata.post_id, { metadata_id: undefined });
      // Delete metadata
      await ctx.db.delete(metadataId);
    }
    return null;
  },
});

export const manuallyFillMetadata = mutation({
  args: {
    metadataId: v.id("post_metadata"),
    event_score: v.optional(v.number()),
    event_date_start: v.optional(v.number()),
    event_date_end: v.optional(v.number()),
    event_time_start: v.optional(v.string()),
    event_time_end: v.optional(v.string()),
    location: v.optional(v.string()),
    location_address: v.optional(v.string()),
    location_coordinates: v.optional(
      v.object({
        lat: v.number(),
        lng: v.number(),
      })
    ),
    event_type: v.optional(
      v.union(
        v.literal("concert"),
        v.literal("workshop"),
        v.literal("conference"),
        v.literal("festival"),
        v.literal("exhibition"),
        v.literal("meetup"),
        v.literal("other")
      )
    ),
    event_title: v.optional(v.string()),
    organizer_name: v.optional(v.string()),
    organizer_contact: v.optional(v.string()),
    target_audience: v.optional(v.array(v.string())),
    registration_required: v.optional(v.boolean()),
    registration_url: v.optional(v.string()),
    ticket_price: v.optional(v.string()),
    event_description: v.optional(v.string()),
    hashtags: v.optional(v.array(v.string())),
    keywords: v.optional(v.array(v.string())),
    language: v.optional(v.string()),
    content_type: v.optional(
      v.union(
        v.literal("event_announcement"),
        v.literal("event_reminder"),
        v.literal("event_recap"),
        v.literal("other")
      )
    ),
    telegram_message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { metadataId, ...updateData } = args;
    const metadata = await ctx.db.get(metadataId);
    if (!metadata) {
      throw new Error(`Metadata with id ${metadataId} not found`);
    }

    const patch: Partial<typeof metadata> = {};
    if (updateData.event_score !== undefined) patch.event_score = updateData.event_score;
    if (updateData.event_date_start !== undefined) patch.event_date_start = updateData.event_date_start;
    if (updateData.event_date_end !== undefined) patch.event_date_end = updateData.event_date_end;
    if (updateData.event_time_start !== undefined) patch.event_time_start = updateData.event_time_start;
    if (updateData.event_time_end !== undefined) patch.event_time_end = updateData.event_time_end;
    if (updateData.location !== undefined) patch.location = updateData.location;
    if (updateData.location_address !== undefined) patch.location_address = updateData.location_address;
    if (updateData.location_coordinates !== undefined) patch.location_coordinates = updateData.location_coordinates;
    if (updateData.event_type !== undefined) patch.event_type = updateData.event_type;
    if (updateData.event_title !== undefined) patch.event_title = updateData.event_title;
    if (updateData.organizer_name !== undefined) patch.organizer_name = updateData.organizer_name;
    if (updateData.organizer_contact !== undefined) patch.organizer_contact = updateData.organizer_contact;
    if (updateData.target_audience !== undefined) patch.target_audience = updateData.target_audience;
    if (updateData.registration_required !== undefined) patch.registration_required = updateData.registration_required;
    if (updateData.registration_url !== undefined) patch.registration_url = updateData.registration_url;
    if (updateData.ticket_price !== undefined) patch.ticket_price = updateData.ticket_price;
    if (updateData.event_description !== undefined) patch.event_description = updateData.event_description;
    if (updateData.hashtags !== undefined) patch.hashtags = updateData.hashtags;
    if (updateData.keywords !== undefined) patch.keywords = updateData.keywords;
    if (updateData.language !== undefined) patch.language = updateData.language;
    if (updateData.content_type !== undefined) patch.content_type = updateData.content_type;
    if (updateData.telegram_message !== undefined) patch.telegram_message = updateData.telegram_message;

    patch.processing_status = "completed";
    patch.processing_completed_at = Date.now();

    await ctx.db.patch(metadataId, patch);
    return metadataId;
  },
});
