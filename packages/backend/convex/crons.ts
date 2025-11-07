import { cronJobs } from "convex/server";
import { internalQuery } from "./_generated/server";
import { startProcessPostMetadata } from "./workflows/postMetadata";
import type { Id } from "./_generated/dataModel";

const crons = cronJobs();

// Backlog processing cron job
// Processes posts without metadata gradually to respect API rate limits
// Google Gemini free tier: ~15 requests per minute
// Default: process 10 posts every 5 minutes (12 posts/hour, well under limit)
crons.interval(
  "processBacklog",
  { minutes: 5 },
  async (ctx) => {
    // Get AI settings
    const settings = await ctx.runQuery(
      internalQuery(async (ctx) => {
        return await ctx.db.query("settings").first();
      })
    );

    if (!settings?.ai_metadata_extraction?.enabled) {
      return;
    }

    const batchSize = settings.ai_metadata_extraction.batch_size ?? 10;
    const maxConcurrent = settings.ai_metadata_extraction.max_concurrent_workflows ?? 1;

    // Find posts without metadata
    const postsWithoutMetadata = await ctx.runQuery(
      internalQuery(async (ctx) => {
        const allPosts = await ctx.db.query("posts").collect();
        const postsWithoutMeta: Array<{ _id: Id<"posts"> }> = [];

        for (const post of allPosts) {
          if (!post.metadata_id) {
            postsWithoutMeta.push({ _id: post._id });
            if (postsWithoutMeta.length >= batchSize) {
              break;
            }
          }
        }

        return postsWithoutMeta;
      })
    );

    // Start workflows for each post, respecting concurrency limit
    let started = 0;
    for (const post of postsWithoutMetadata) {
      if (started >= maxConcurrent) {
        // Wait a bit before starting more to respect rate limits
        await new Promise((resolve) => setTimeout(resolve, 5000)); // 5 second delay
        started = 0;
      }

      try {
        await ctx.scheduler.runAfter(0, startProcessPostMetadata, {
          postId: post._id,
        });
        started++;
      } catch (error) {
        console.error(
          `Failed to start workflow for post ${post._id}:`,
          error
        );
      }
    }
  }
);

export default crons;
