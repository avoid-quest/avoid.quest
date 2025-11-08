import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { workflow } from "./workflows/workflow";

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MS_PER_SECOND = 1000;
const ONE_HOUR_MS = SECONDS_PER_MINUTE * MINUTES_PER_HOUR * MS_PER_SECOND;

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
 * Internal query to check if metadata exists and is completed for a post
 * Returns true if we should skip processing (metadata is completed)
 * Returns false if we should process (no metadata, failed, or stuck processing)
 */
export const checkMetadataExists = internalQuery({
  args: { postId: v.id("posts") },
  returns: v.boolean(),
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) {
      return true; // Post doesn't exist, skip
    }

    // If post has metadata_id linked, check if it's completed
    if (post.metadata_id) {
      const metadata = await ctx.db.get(post.metadata_id);
      if (metadata?.processing_status === "completed") {
        return true; // Already completed, skip
      }
      // If linked but not completed, we should retry
      return false;
    }

    // Check if metadata record exists (in case post.metadata_id is not set but record exists)
    const existingMetadata = await ctx.db
      .query("post_metadata")
      .withIndex("by_post_id", (q) => q.eq("post_id", postId))
      .first();

    if (!existingMetadata) {
      return false; // No metadata record, should process
    }

    // Only skip if metadata is completed
    // Retry if failed, processing, or pending
    if (existingMetadata.processing_status === "completed") {
      return true; // Completed, skip
    }

    // Check if processing is stuck (processing for more than 1 hour)
    if (existingMetadata.processing_status === "processing") {
      const processingStartedAt = existingMetadata.processing_started_at ?? 0;
      const isStuck = Date.now() - processingStartedAt > ONE_HOUR_MS;

      if (isStuck) {
        console.log(
          `Metadata for post ${postId} is stuck in processing (started ${Date.now() - processingStartedAt}ms ago), will retry`
        );
        return false; // Stuck, should retry
      }

      // Still processing and not stuck, skip for now
      return true;
    }

    // Failed or pending, should retry
    return false;
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
    // Reduced defaults to respect Gemini free tier (50 requests limit)
    const DEFAULT_BATCH_SIZE = 1;
    const DEFAULT_MAX_CONCURRENT_WORKFLOWS = 1; // Reduced from 3 to avoid quota issues

    if (!aiSettings?.enabled) {
      console.log("AI metadata extraction is disabled in settings");
      return { processed: 0, skipped: 0, errors: 0 };
    }

    const batchSize = aiSettings.batch_size ?? DEFAULT_BATCH_SIZE;
    const maxConcurrent =
      aiSettings.max_concurrent_workflows ?? DEFAULT_MAX_CONCURRENT_WORKFLOWS;

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

      // Add delay between batches to respect rate limits (only if not last batch)
      if (i + maxConcurrent < postsWithoutMetadata.length) {
        const BATCH_DELAY_SECONDS = 5; // 5 seconds between batches
        console.log(`Waiting ${BATCH_DELAY_SECONDS}s before next batch...`);
        await new Promise((resolve) =>
          setTimeout(resolve, BATCH_DELAY_SECONDS * MS_PER_SECOND)
        );
      }
    }

    console.log(
      `Metadata backlog processing complete: processed=${processed}, skipped=${skipped}, errors=${errors}`
    );

    return { processed, skipped, errors };
  },
});

const crons = cronJobs();

// Run every 15 minutes by default (respects Groq API rate limits)
// The interval can be configured via settings.ai_metadata_extraction.backlog_interval_minutes
crons.interval(
  "process-metadata-backlog",
  { minutes: 15 },
  internal.crons.processMetadataBacklog,
  {}
);

export default crons;
