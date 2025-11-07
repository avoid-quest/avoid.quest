import { vWorkflowId, type WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { workflow } from "./workflows/workflow";

/**
 * Test mutation to start the metadata extraction workflow for a post
 * Usage: Call this mutation with a postId to test the workflow
 */
export const testProcessPostMetadata = mutation({
  args: { postId: v.id("posts") },
  returns: v.object({
    workflowId: v.string(),
    message: v.string(),
  }),
  handler: async (ctx, { postId }) => {
    // Verify post exists
    const post = await ctx.db.get(postId);
    if (!post) {
      throw new Error(`Post ${postId} not found`);
    }

    // Start the workflow
    const workflowId: WorkflowId = await workflow.start(
      ctx,
      internal.workflows.postMetadata.processPostMetadata,
      { postId }
    );

    return {
      workflowId: workflowId as string,
      message: `Workflow started for post ${postId}. Workflow ID: ${workflowId}`,
    };
  },
});

/**
 * Test mutation to create a sample post and trigger metadata extraction
 * This is useful for quick testing without needing real Instagram data
 */
export const testCreatePostAndExtractMetadata = mutation({
  args: {
    caption: v.string(),
    url: v.optional(v.string()),
  },
  returns: v.object({
    postId: v.id("posts"),
    workflowId: v.string(),
  }),
  handler: async (ctx, { caption, url }) => {
    // Create a test user if needed (or use existing)
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", "test_user"))
      .first();

    const userId: Id<"users"> = user
      ? user._id
      : await ctx.db.insert("users", {
          username: "test_user",
          to_be_scraped: false,
        });

    // Create a test post
    const postId = await ctx.db.insert("posts", {
      ig_id: `test_${Date.now()}`,
      shortcode: `test_${Date.now()}`,
      display_url: "https://example.com/image.jpg",
      caption,
      is_video: false,
      url: url ?? `https://instagram.com/p/test_${Date.now()}`,
      media_type: "image",
      users: [userId],
      timestamp: Date.now(),
      sent: false,
    });

    // Start the workflow
    const workflowId: WorkflowId = await workflow.start(
      ctx,
      internal.workflows.postMetadata.processPostMetadata,
      { postId }
    );

    return {
      postId,
      workflowId: workflowId as string,
    };
  },
});

/**
 * Query to check workflow status
 */
export const getWorkflowStatus = query({
  args: { workflowId: vWorkflowId },
  returns: v.any(),
  handler: async (ctx, { workflowId }) =>
    await workflow.status(ctx, workflowId),
});

/**
 * Query to check test post metadata (uses existing getPostMetadata from post_metadata.ts)
 * This is just a convenience wrapper for testing
 */
export const checkTestPostMetadata = query({
  args: { postId: v.id("posts") },
  returns: v.any(),
  handler: async (ctx, { postId }) => {
    const metadata = await ctx.db
      .query("post_metadata")
      .withIndex("by_post_id", (q) => q.eq("post_id", postId))
      .first();

    const post = await ctx.db.get(postId);

    return {
      post: post
        ? {
            _id: post._id,
            caption: post.caption,
            url: post.url,
            metadata_id: post.metadata_id,
          }
        : null,
      metadata,
    };
  },
});

/**
 * Comprehensive query to check workflow execution and results
 * Shows workflow status, post data, and extracted metadata all in one place
 */
export const checkWorkflowResults = query({
  args: { workflowId: vWorkflowId },
  returns: v.any(),
  handler: async (ctx, { workflowId }) => {
    const status = await workflow.status(ctx, workflowId);

    // Extract postId from completed workflow result
    let postId: Id<"posts"> | null = null;
    if (status.type === "completed") {
      const completedStatus = status as unknown as {
        result: {
          kind: string;
          returnValue?: { metadataId?: Id<"post_metadata"> };
        };
      };
      if (
        completedStatus.result.kind === "success" &&
        completedStatus.result.returnValue?.metadataId
      ) {
        const metadata = await ctx.db.get(
          completedStatus.result.returnValue.metadataId
        );
        if (metadata) {
          postId = metadata.post_id;
        }
      }
    }

    // Get post and metadata
    const post = postId ? await ctx.db.get(postId) : null;
    const metadata = postId
      ? await ctx.db
          .query("post_metadata")
          .withIndex("by_post_id", (q) => q.eq("post_id", postId))
          .first()
      : null;

    // Build workflow result
    let workflowResult: unknown = null;
    if (status.type === "completed") {
      workflowResult = status;
    } else if (status.type === "failed") {
      workflowResult = { error: (status as { error: string }).error };
    }

    return {
      workflow: {
        id: workflowId,
        status: status.type,
        result: workflowResult,
      },
      post: post
        ? {
            _id: post._id,
            caption: post.caption,
            url: post.url,
            metadata_id: post.metadata_id,
          }
        : null,
      metadata: metadata
        ? {
            _id: metadata._id,
            event_score: metadata.event_score,
            event_title: metadata.event_title,
            event_description: metadata.event_description,
            event_date_start: metadata.event_date_start,
            event_time_start: metadata.event_time_start,
            location: metadata.location,
            location_address: metadata.location_address,
            ticket_price: metadata.ticket_price,
            registration_url: metadata.registration_url,
            organizer_name: metadata.organizer_name,
            hashtags: metadata.hashtags,
            telegram_message: metadata.telegram_message,
            processing_status: metadata.processing_status,
            processing_error: metadata.processing_error,
            ai_model_used: metadata.ai_model_used,
            processing_started_at: metadata.processing_started_at,
            processing_completed_at: metadata.processing_completed_at,
          }
        : null,
    };
  },
});

const DEFAULT_CAPTION_PREVIEW_LENGTH = 100;

/**
 * Query to list all recent metadata extractions for debugging
 */
export const listRecentMetadata = query({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { limit = 10 }) => {
    const metadataList = await ctx.db
      .query("post_metadata")
      .order("desc")
      .take(limit);

    const results = await Promise.all(
      metadataList.map(async (meta) => {
        const post = await ctx.db.get(meta.post_id);
        const captionPreview = post?.caption
          ? post.caption.substring(0, DEFAULT_CAPTION_PREVIEW_LENGTH)
          : "N/A";

        return {
          metadata_id: meta._id,
          post_id: meta.post_id,
          post_caption: captionPreview,
          event_score: meta.event_score,
          event_title: meta.event_title,
          processing_status: meta.processing_status,
          processing_error: meta.processing_error,
          ai_model_used: meta.ai_model_used,
          created_at: meta._creationTime,
          completed_at: meta.processing_completed_at,
        };
      })
    );

    return results;
  },
});
