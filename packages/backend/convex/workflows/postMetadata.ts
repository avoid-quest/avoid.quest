import { vWorkflowId, type WorkflowId } from "@convex-dev/workflow";
import { vResultValidator } from "@convex-dev/workpool";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { MODEL_IDENTIFIER } from "../ai/config";
import { postMetadataValidator } from "../ai/postMetadataExtractorAgent";
import { now } from "../lib/dateUtils";
import { workflow } from "./workflow";

/**
 * Get post data
 */
export const getPostData = internalQuery({
	args: { postId: v.id("posts") },
	returns: v.object({
		_id: v.id("posts"),
		caption: v.string(),
		url: v.string(),
		timestamp: v.number(),
	}),
	handler: async (ctx, { postId }) => {
		const post = await ctx.db.get(postId);
		if (!post) {
			throw new Error(`Post ${postId} not found`);
		}
		return {
			_id: post._id,
			caption: post.caption,
			url: post.url,
			timestamp: post.timestamp,
		};
	},
});

/**
 * Create or get metadata record
 */
export const createOrGetMetadata = internalMutation({
	args: { postId: v.id("posts") },
	returns: v.id("post_metadata"),
	handler: async (ctx, { postId }) => {
		const existing = await ctx.db
			.query("post_metadata")
			.withIndex("by_post_id", (q) => q.eq("post_id", postId))
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, {
				processing_status: "processing",
				processing_started_at: now(),
			});
			return existing._id;
		}

		const metadataId = await ctx.db.insert("post_metadata", {
			post_id: postId,
			event_score: 0,
			processing_status: "processing",
			processing_started_at: now(),
			extraction_version: 1,
		});

		return metadataId;
	},
});

/**
 * Save extracted metadata
 */
export const saveMetadata = internalMutation({
	args: {
		metadataId: v.id("post_metadata"),
		extractedData: postMetadataValidator,
		aiModelUsed: v.string(),
		threadId: v.string(),
		telegramMessage: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (
		ctx,
		{ metadataId, extractedData, aiModelUsed, threadId, telegramMessage },
	) => {
		const metadata = await ctx.db.get(metadataId);
		if (!metadata) {
			throw new Error(`Metadata ${metadataId} not found`);
		}

		// Update metadata - only fields that exist in extractedData will be set
		// Store thread ID for tracking and debugging (each post has isolated thread)
		// Include telegram message if it was generated
		await ctx.db.patch(metadataId, {
			...extractedData,
			processing_status: "completed",
			processing_completed_at: now(),
			ai_model_used: aiModelUsed,
			agent_thread_id: threadId,
			...(telegramMessage !== undefined && {
				telegram_message: telegramMessage,
			}),
		});

		// Link metadata to post
		await ctx.db.patch(metadata.post_id, { metadata_id: metadataId });
	},
});

/**
 * Save telegram message to metadata
 */
export const saveTelegramMessage = internalMutation({
	args: {
		metadataId: v.id("post_metadata"),
		telegramMessage: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, { metadataId, telegramMessage }) => {
		const metadata = await ctx.db.get(metadataId);
		if (!metadata) {
			throw new Error(`Metadata ${metadataId} not found`);
		}

		await ctx.db.patch(metadataId, {
			telegram_message: telegramMessage,
		});
	},
});

/**
 * Mark metadata as failed
 */
export const markMetadataFailed = internalMutation({
	args: {
		metadataId: v.id("post_metadata"),
		error: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, { metadataId, error }) => {
		await ctx.db.patch(metadataId, {
			processing_status: "failed",
			processing_completed_at: now(),
			processing_error: error,
		});
	},
});

/**
 * Handle workflow completion - processes success, error, or cancellation
 */
export const handlePostMetadataCompletion = internalMutation({
	args: {
		workflowId: vWorkflowId,
		result: vResultValidator,
		context: v.object({
			postId: v.id("posts"),
		}),
	},
	returns: v.null(),
	handler: async (ctx, { result, context }) => {
		const { postId } = context;

		if (result.kind === "success") {
			// Workflow succeeded - metadata should already be saved
			// Verify it's marked as completed
			const metadataId = result.returnValue.metadataId;
			if (metadataId) {
				const metadata = await ctx.db.get(metadataId);
				if (
					metadata &&
					"processing_status" in metadata &&
					metadata.processing_status !== "completed"
				) {
					// Ensure it's marked as completed (should already be done in workflow)
					await ctx.db.patch(metadataId, {
						processing_status: "completed",
						processing_completed_at: now(),
					});
				}
			}
			return;
		}

		// Handle failed or canceled cases
		let errorMessage: string;
		if (result.kind === "failed") {
			errorMessage = result.error;
		} else {
			// result.kind === "canceled"
			errorMessage = "Workflow was canceled";
		}

		// Try to find existing metadata record
		const existing = await ctx.db
			.query("post_metadata")
			.withIndex("by_post_id", (q) => q.eq("post_id", postId))
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, {
				processing_status: "failed",
				processing_completed_at: now(),
				processing_error: errorMessage,
			});
		} else {
			// Create failed metadata record if it doesn't exist
			const failedMetadataId = await ctx.db.insert("post_metadata", {
				post_id: postId,
				event_score: 0,
				processing_status: "failed",
				processing_started_at: now(),
				processing_completed_at: now(),
				processing_error: errorMessage,
				extraction_version: 1,
			});
			await ctx.db.patch(postId, { metadata_id: failedMetadataId });
		}
	},
});

/**
 * Public action to trigger metadata extraction workflow for testing
 */
export const triggerMetadataExtraction = action({
	args: { postId: v.id("posts") },
	returns: v.string(),
	handler: async (ctx, { postId }): Promise<string> => {
		const workflowId: WorkflowId = await workflow.start(
			ctx,
			internal.workflows.postMetadata.processPostMetadata,
			{ postId },
			{
				onComplete:
					internal.workflows.postMetadata.handlePostMetadataCompletion,
				context: { postId },
			},
		);
		return workflowId;
	},
});

/**
 * Process post metadata extraction
 * Uses onComplete callback for error handling instead of try-catch
 */
export const processPostMetadata = workflow.define({
	args: { postId: v.id("posts") },
	returns: v.object({
		metadataId: v.id("post_metadata"),
	}),
	handler: async (
		step,
		{ postId },
	): Promise<{
		metadataId: Id<"post_metadata">;
	}> => {
		// Create or get metadata record
		const metadataId = await step.runMutation(
			internal.workflows.postMetadata.createOrGetMetadata,
			{ postId },
		);

		// Get post data
		const post = await step.runQuery(
			internal.workflows.postMetadata.getPostData,
			{ postId },
		);

		// Timestamp is already in milliseconds (database stores in milliseconds)
		// No conversion needed - pass directly to AI extraction

		// Extract metadata - errors will propagate to onComplete handler
		// Each post gets its own isolated thread for proper context separation
		const extractionResult = await step.runAction(
			internal.ai.postMetadataExtractorAgent.extractPostMetadata,
			{
				postId,
				caption: post.caption,
				postUrl: post.url,
				timestamp: post.timestamp,
			},
			{ retry: true },
		);

		// Use constant model identifier (workflow steps can't access process.env)
		const aiModelUsed = MODEL_IDENTIFIER;

		// Generate telegram message for high-confidence events (event_score >= 70)
		// Do this BEFORE marking metadata as completed to avoid race conditions
		const HIGH_CONFIDENCE_THRESHOLD = 70;
		let telegramMessage: string | undefined;

		if (
			extractionResult.extractedData.event_score >= HIGH_CONFIDENCE_THRESHOLD
		) {
			console.log(
				`Generating telegram message for post ${postId} (event_score: ${extractionResult.extractedData.event_score})`,
			);
			try {
				// Generate telegram message using AI
				telegramMessage = await step.runAction(
					internal.ai.telegramMessageGenerator.generateTelegramMessage,
					{
						metadata: extractionResult.extractedData,
						postUrl: post.url,
						originalCaption: post.caption,
					},
					{ retry: true },
				);

				console.log(
					`Telegram message generated successfully for post ${postId}, length: ${telegramMessage.length}`,
				);
			} catch (error) {
				// Log error but don't fail the workflow if message generation fails
				// The workflow has already successfully extracted metadata
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				const errorStack = error instanceof Error ? error.stack : undefined;
				console.error(
					`Failed to generate telegram message for post ${postId}:`,
					errorMessage,
					errorStack ? `\nStack: ${errorStack}` : "",
				);
				// Continue without telegram message - metadata extraction was successful
			}
		} else {
			console.log(
				`Skipping telegram message generation for post ${postId} (event_score: ${extractionResult.extractedData.event_score} < ${HIGH_CONFIDENCE_THRESHOLD})`,
			);
		}

		// Save metadata with thread ID and telegram message (if generated)
		// This ensures metadata is marked as completed only after telegram message is saved
		await step.runMutation(internal.workflows.postMetadata.saveMetadata, {
			metadataId,
			extractedData: extractionResult.extractedData,
			aiModelUsed,
			threadId: extractionResult.threadId,
			telegramMessage,
		});

		if (telegramMessage) {
			console.log(`Telegram message saved to metadata for post ${postId}`);
		}

		return { metadataId };
	},
});
