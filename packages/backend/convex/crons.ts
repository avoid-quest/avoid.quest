import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./_generated/server";
import { now } from "./lib/dateUtils";
import { createLogger } from "./lib/logger";
import { workflow } from "./workflows/workflow";

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MS_PER_SECOND = 1000;
const ONE_HOUR_MS = SECONDS_PER_MINUTE * MINUTES_PER_HOUR * MS_PER_SECOND;
/** Buffer time to avoid race conditions when checking for stuck processes */
const STUCK_BUFFER_MS = 5 * SECONDS_PER_MINUTE * MS_PER_SECOND; // 5 minutes

/**
 * Internal query to get posts without metadata_id
 */
export const getPostsWithoutMetadata = internalQuery({
	args: { limit: v.number() },
	returns: v.array(v.id("posts")),
	handler: async (ctx, { limit }) => {
		const posts = await ctx.db
			.query("posts")
			.withIndex("by_metadata_id", (q) => q.eq("metadata_id", undefined))
			.take(limit);
		return posts.map((post) => post._id);
	},
});

/**
 * Check if metadata processing should be skipped for a post
 * Returns true if we should skip processing (metadata is completed or actively processing)
 * Returns false if we should process (no metadata, failed, or stuck processing)
 */
export const shouldSkipMetadataProcessing = internalQuery({
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

		// Check if processing is stuck (processing for more than 1 hour + buffer)
		// Buffer avoids race conditions where a process is checked near the boundary
		if (existingMetadata.processing_status === "processing") {
			const processingStartedAt = existingMetadata.processing_started_at ?? 0;
			const currentTime = now();
			const processingDuration = currentTime - processingStartedAt;
			const isStuck = processingDuration > ONE_HOUR_MS + STUCK_BUFFER_MS;

			if (isStuck) {
				// Stuck processing - should retry
				return false;
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
		failedPostIds: v.array(v.string()),
	}),
	handler: async (ctx) => {
		const logger = createLogger("metadata-backlog");

		// Get settings to check if enabled and get batch size
		const settings = await ctx.runQuery(internal.settings.getSettingsInternal);
		const aiSettings = settings?.ai_metadata_extraction;

		// Default values for AI metadata extraction settings
		// Reduced defaults to respect Groq API rate limits
		const DEFAULT_BATCH_SIZE = 1;
		const DEFAULT_MAX_CONCURRENT_WORKFLOWS = 1; // Reduced from 3 to avoid quota issues

		if (!aiSettings?.active) {
			logger.info("AI metadata extraction is disabled in settings");
			return { processed: 0, skipped: 0, errors: 0, failedPostIds: [] };
		}

		const batchSize = aiSettings.batch_size ?? DEFAULT_BATCH_SIZE;
		const maxConcurrent =
			aiSettings.max_concurrent_workflows ?? DEFAULT_MAX_CONCURRENT_WORKFLOWS;

		logger.info(
			`Processing metadata backlog: batchSize=${batchSize}, maxConcurrent=${maxConcurrent}`,
		);

		// Find posts without metadata_id
		const postsWithoutMetadata = await ctx.runQuery(
			internal.crons.getPostsWithoutMetadata,
			{ limit: batchSize },
		);

		logger.info(
			`Found ${postsWithoutMetadata.length} posts without metadata_id`,
		);

		if (postsWithoutMetadata.length === 0) {
			return { processed: 0, skipped: 0, errors: 0, failedPostIds: [] };
		}

		let processed = 0;
		let skipped = 0;
		let errors = 0;
		const failedPostIds: string[] = [];

		// Process posts in batches respecting max concurrent workflows
		for (let i = 0; i < postsWithoutMetadata.length; i += maxConcurrent) {
			const batch = postsWithoutMetadata.slice(i, i + maxConcurrent);

			const results = await Promise.allSettled(
				batch.map(async (postId: Id<"posts">) => {
					try {
						// Check if metadata already exists for this post
						const hasMetadata = await ctx.runQuery(
							internal.crons.shouldSkipMetadataProcessing,
							{ postId },
						);

						if (hasMetadata) {
							skipped++;
							return;
						}

						// Start workflow for this post with completion handler
						await workflow.start(
							ctx,
							internal.workflows.postMetadata.processPostMetadata,
							{ postId },
							{
								onComplete:
									internal.workflows.postMetadata.handlePostMetadataCompletion,
								context: { postId },
							},
						);
						processed++;
					} catch (error) {
						logger.error(
							`Error processing post ${postId}: ${error instanceof Error ? error.message : String(error)}`,
						);
						errors++;
						failedPostIds.push(postId);
					}
				}),
			);

			// Log any failures from Promise.allSettled rejections
			for (const [index, result] of results.entries()) {
				if (result.status === "rejected") {
					const postId = batch[index];
					logger.error(
						`Failed to process post ${postId}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
					);
					// Avoid duplicate tracking - only add if not already tracked via catch
					if (postId && !failedPostIds.includes(postId)) {
						failedPostIds.push(postId);
						errors++;
					}
				}
			}

			// Add delay between batches to respect rate limits (only if not last batch)
			if (i + maxConcurrent < postsWithoutMetadata.length) {
				const BATCH_DELAY_SECONDS = 5; // 5 seconds between batches
				logger.debug(`Waiting ${BATCH_DELAY_SECONDS}s before next batch...`);
				await new Promise((resolve) =>
					setTimeout(resolve, BATCH_DELAY_SECONDS * MS_PER_SECOND),
				);
			}
		}

		logger.info(
			`Metadata backlog processing complete: processed=${processed}, skipped=${skipped}, errors=${errors}`,
		);

		if (failedPostIds.length > 0) {
			logger.warn(`Failed post IDs: ${failedPostIds.join(", ")}`);
		}

		return { processed, skipped, errors, failedPostIds };
	},
});

const crons = cronJobs();

// Run every 15 minutes (hardcoded interval to respect Groq API rate limits)
// Note: Convex cron jobs require static intervals, so the interval cannot be
// dynamically configured via settings. The settings.backlog_interval_minutes
// value is reserved for future use if Convex adds support for dynamic intervals.
crons.interval(
	"process-metadata-backlog",
	{ minutes: 15 },
	internal.crons.processMetadataBacklog,
	{},
);

export default crons;
