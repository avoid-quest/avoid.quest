import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

export const getPostMetadata = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) =>
    await ctx.db
      .query("post_metadata")
      .withIndex("by_post_id", (q) => q.eq("post_id", postId))
      .first(),
});

const DEFAULT_POSTS_LIMIT = 100;

export const getPostsWithMetadata = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit ?? DEFAULT_POSTS_LIMIT);

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

const DEFAULT_EVENT_SCORE_THRESHOLD = 70;

export const getHighConfidenceEvents = query({
  args: { threshold: v.optional(v.number()) },
  handler: async (ctx, { threshold = DEFAULT_EVENT_SCORE_THRESHOLD }) =>
    await ctx.db
      .query("post_metadata")
      .withIndex("by_event_score")
      .filter((q) => q.gte(q.field("event_score"), threshold))
      .collect(),
});

export const getUpcomingEvents = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    return await ctx.db
      .query("post_metadata")
      .withIndex("by_event_date_start")
      .filter((q) => q.gte(q.field("event_date_start"), now))
      .collect();
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
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("post_metadata")
      .withIndex("by_processing_status", (q) =>
        q.eq("processing_status", "failed")
      )
      .collect(),
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

    if (!metadata?.agent_thread_id) {
      return null;
    }

    // Note: This would need to query the agent component's thread table
    // For now, return the thread ID so it can be looked up in the dashboard
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
    const metadata = await ctx.db
      .query("post_metadata")
      .withIndex("by_post_id", (q) => q.eq("post_id", postId))
      .first();

    if (!metadata) {
      throw new Error(`No metadata found for post ${postId}`);
    }

    // Reset status to pending for reprocessing
    await ctx.db.patch(metadata._id, {
      processing_status: "pending",
      processing_error: undefined,
      processing_started_at: undefined,
      processing_completed_at: undefined,
    });

    return metadata._id;
  },
});

export const batchReprocessMetadata = mutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 10 }) => {
    const postsWithoutMetadata = await ctx.db
      .query("posts")
      .filter((q) => q.eq(q.field("metadata_id"), undefined))
      .take(limit);

    return postsWithoutMetadata.map((post) => post._id);
  },
});

export const clearMetadata = mutation({
  args: { metadataId: v.id("post_metadata") },
  handler: async (ctx, { metadataId }) => {
    const metadata = await ctx.db.get(metadataId);
    if (!metadata) {
      throw new Error(`Metadata ${metadataId} not found`);
    }

    // Remove reference from post
    await ctx.db.patch(metadata.post_id, { metadata_id: undefined });

    // Delete metadata
    await ctx.db.delete(metadataId);
  },
});

export const updateMetadataSettings = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    model: v.optional(v.string()),
    batch_size: v.optional(v.number()),
    backlog_interval_minutes: v.optional(v.number()),
    max_concurrent_workflows: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const settings = await ctx.db.query("settings").first();
    if (!settings) {
      throw new Error("Settings not found");
    }

    const currentAiSettings = settings.ai_metadata_extraction ?? {
      enabled: true,
      model: "gemini-2.5-flash",
      batch_size: 10,
      backlog_interval_minutes: 5,
      max_concurrent_workflows: 1,
    };

    const updatedAiSettings = {
      ...currentAiSettings,
      ...(args.enabled !== undefined && { enabled: args.enabled }),
      ...(args.model !== undefined && { model: args.model }),
      ...(args.batch_size !== undefined && { batch_size: args.batch_size }),
      ...(args.backlog_interval_minutes !== undefined && {
        backlog_interval_minutes: args.backlog_interval_minutes,
      }),
      ...(args.max_concurrent_workflows !== undefined && {
        max_concurrent_workflows: args.max_concurrent_workflows,
      }),
    };

    await ctx.db.patch(settings._id, {
      ai_metadata_extraction: updatedAiSettings,
    });

    return updatedAiSettings;
  },
});

export const manuallyFillMetadata = mutation({
  args: {
    postId: v.id("posts"),
    event_score: v.number(),
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
    const { postId, ...metadataFields } = args;

    // Check if metadata already exists
    const existing = await ctx.db
      .query("post_metadata")
      .withIndex("by_post_id", (q) => q.eq("post_id", postId))
      .first();

    const now = Date.now();
    const metadataData = {
      post_id: postId,
      event_score: metadataFields.event_score,
      event_date_start: metadataFields.event_date_start,
      event_date_end: metadataFields.event_date_end,
      event_time_start: metadataFields.event_time_start,
      event_time_end: metadataFields.event_time_end,
      location: metadataFields.location,
      location_address: metadataFields.location_address,
      location_coordinates: metadataFields.location_coordinates,
      event_type: metadataFields.event_type,
      event_title: metadataFields.event_title,
      organizer_name: metadataFields.organizer_name,
      organizer_contact: metadataFields.organizer_contact,
      target_audience: metadataFields.target_audience,
      registration_required: metadataFields.registration_required,
      registration_url: metadataFields.registration_url,
      ticket_price: metadataFields.ticket_price,
      event_description: metadataFields.event_description,
      hashtags: metadataFields.hashtags,
      keywords: metadataFields.keywords,
      language: metadataFields.language,
      content_type: metadataFields.content_type,
      telegram_message: metadataFields.telegram_message,
      processing_status: "completed" as const,
      processing_started_at: existing?.processing_started_at ?? now,
      processing_completed_at: now,
      processing_error: undefined,
      ai_model_used: "manual",
      extraction_version: (existing?.extraction_version ?? 0) + 1,
      agent_thread_id: existing?.agent_thread_id,
    };

    let metadataId: Id<"post_metadata">;
    if (existing) {
      await ctx.db.patch(existing._id, metadataData);
      metadataId = existing._id;
    } else {
      metadataId = await ctx.db.insert("post_metadata", metadataData);
    }

    // Link to post
    await ctx.db.patch(postId, { metadata_id: metadataId });

    return metadataId;
  },
});
