import { vWorkflowId } from "@convex-dev/workflow";
import { vResultValidator } from "@convex-dev/workpool";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
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
  },
  returns: v.null(),
  handler: async (
    ctx,
    { metadataId, extractedData, aiModelUsed, threadId }
  ) => {
    const metadata = await ctx.db.get(metadataId);
    if (!metadata) {
      throw new Error(`Metadata ${metadataId} not found`);
    }

    // Update metadata - only fields that exist in extractedData will be set
    // Store thread ID for tracking and debugging (each post has isolated thread)
    await ctx.db.patch(metadataId, {
      ...extractedData,
      processing_status: "completed",
      processing_completed_at: now(),
      ai_model_used: aiModelUsed,
      agent_thread_id: threadId,
    });

    // Link metadata to post
    await ctx.db.patch(metadata.post_id, { metadata_id: metadataId });
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
    { postId }
  ): Promise<{
    metadataId: Id<"post_metadata">;
  }> => {
    // Create or get metadata record
    const metadataId = await step.runMutation(
      internal.workflows.postMetadata.createOrGetMetadata,
      { postId }
    );

    // Get post data
    const post = await step.runQuery(
      internal.workflows.postMetadata.getPostData,
      { postId }
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
      { retry: true }
    );

    // Use constant model identifier (workflow steps can't access process.env)
    const aiModelUsed = MODEL_IDENTIFIER;

    // Save metadata with thread ID for tracking and debugging
    await step.runMutation(internal.workflows.postMetadata.saveMetadata, {
      metadataId,
      extractedData: extractionResult.extractedData,
      aiModelUsed,
      threadId: extractionResult.threadId,
    });

    return { metadataId };
  },
});
