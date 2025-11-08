import { cronJobs } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { workflow } from "./workflows/workflow";

/**
 * Internal query to get posts without metadata_id
 */
export const getPostsWithoutMetadata = internalQuery({
  args: { limit: v.number() },
  returns: v.array(v.id("posts")),
  handler: async (ctx, { limit }) => {
    const posts = await ctx.db
      .query("posts")
      .filter((q) => q.eq(q.field("metadata_id"), undefined))
      .order("desc")
      .take(limit);
    return posts.map((post) => post._id);
  },
});

/**
 * Internal query to check if metadata exists for a post
 */
export const checkMetadataExists = internalQuery({
  args: { postId: v.id("posts") },
  returns: v.boolean(),
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post || post.metadata_id) {
      return true; // Post doesn't exist or already has metadata
    }

    // Also check if metadata record exists (in case post.metadata_id is not set but record exists)
    const existingMetadata = await ctx.db
      .query("post_metadata")
      .withIndex("by_post_id", (q) => q.eq("post_id", postId))
      .first();

    return existingMetadata !== null;
  },
});

/**
 * Process backlog of posts without metadata extraction
 * Finds posts without metadata_id and starts workflows for them
 */
export const processMetadataBacklog = internalAction({
  args: {},
  returns: v.object({
    processed: v.number(),
    skipped: v.number(),
    errors: v.number(),
  }),
  handler: async (ctx) => {
    // Get settings to check if enabled and get batch size
    const settings = await ctx.runQuery(internal.settings.getSettingsInternal);
    const aiSettings = settings?.ai_metadata_extraction;

    // Default values for AI metadata extraction settings
    const DEFAULT_BATCH_SIZE = 1;
    const DEFAULT_MAX_CONCURRENT_WORKFLOWS = 3;

    if (!aiSettings?.enabled) {
      console.log("AI metadata extraction is disabled in settings");
      return { processed: 0, skipped: 0, errors: 0 };
    }

    const batchSize = aiSettings.batch_size ?? DEFAULT_BATCH_SIZE;
    const maxConcurrent = aiSettings.max_concurrent_workflows ?? DEFAULT_MAX_CONCURRENT_WORKFLOWS;

    console.log(
      `Processing metadata backlog: batchSize=${batchSize}, maxConcurrent=${maxConcurrent}`
    );

    // Find posts without metadata_id
    const postsWithoutMetadata = await ctx.runQuery(
      internal.crons.getPostsWithoutMetadata,
      { limit: batchSize }
    );

    console.log(
      `Found ${postsWithoutMetadata.length} posts without metadata_id`
    );

    if (postsWithoutMetadata.length === 0) {
      return { processed: 0, skipped: 0, errors: 0 };
    }

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    // Process posts in batches respecting max concurrent workflows
    for (let i = 0; i < postsWithoutMetadata.length; i += maxConcurrent) {
      const batch = postsWithoutMetadata.slice(i, i + maxConcurrent);

      const results = await Promise.allSettled(
        batch.map(async (postId) => {
          try {
            // Check if metadata already exists for this post
            const hasMetadata = await ctx.runQuery(
              internal.crons.checkMetadataExists,
              { postId }
            );

            if (hasMetadata) {
              skipped++;
              return;
            }

            // Start workflow for this post
            await workflow.start(
              ctx,
              internal.workflows.postMetadata.processPostMetadata,
              { postId }
            );
            processed++;
          } catch (error) {
            console.error(`Error processing post ${postId}:`, error);
            errors++;
          }
        })
      );

      // Log any failures
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          console.error(
            `Failed to process post ${batch[index]}:`,
            result.reason
          );
        }
      });
    }

    console.log(
      `Metadata backlog processing complete: processed=${processed}, skipped=${skipped}, errors=${errors}`
    );

    return { processed, skipped, errors };
  },
});

const crons = cronJobs();

// Run every 15 minutes by default (respects Google Gemini free tier rate limits)
// The interval can be configured via settings.ai_metadata_extraction.backlog_interval_minutes
crons.interval(
  "process-metadata-backlog",
  { minutes: 15 },
  internal.crons.processMetadataBacklog,
  {}
);

export default crons;

