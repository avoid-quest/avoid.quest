import type { FunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import {
  extractPostMetadata,
  type PostMetadataExtraction,
  postMetadataValidator,
} from "../ai/postMetadataExtractorAgent";
import { generateTelegramMessage } from "../ai/telegramMessageGenerator";
import { workflow } from "./workflow";

/**
 * Internal query to get post data
 */
export const getPostData = internalQuery({
  args: { postId: v.id("posts") },
  returns: v.object({
    _id: v.id("posts"),
    caption: v.string(),
    url: v.string(),
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
    };
  },
});

/**
 * Internal mutation to create or get metadata record
 */
export const createOrGetMetadata = internalMutation({
  args: { postId: v.id("posts") },
  returns: v.id("post_metadata"),
  handler: async (ctx, { postId }) => {
    // Check if metadata already exists
    const existing = await ctx.db
      .query("post_metadata")
      .withIndex("by_post_id", (q) => q.eq("post_id", postId))
      .first();

    if (existing) {
      // Update status to processing
      await ctx.db.patch(existing._id, {
        processing_status: "processing",
        processing_started_at: Date.now(),
        processing_error: undefined,
      });
      return existing._id;
    }

    // Create new metadata record
    const metadataId = await ctx.db.insert("post_metadata", {
      post_id: postId,
      event_score: 0,
      processing_status: "processing",
      processing_started_at: Date.now(),
      extraction_version: 1,
    });

    return metadataId;
  },
});

/**
 * Internal mutation to save extracted metadata
 */
export const saveMetadata = internalMutation({
  args: {
    metadataId: v.id("post_metadata"),
    extractedData: postMetadataValidator,
    telegramMessage: v.optional(v.string()),
    agentThreadId: v.optional(v.string()),
    aiModelUsed: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const {
      metadataId,
      extractedData,
      telegramMessage,
      agentThreadId,
      aiModelUsed,
    } = args;

    const now = Date.now();
    const metadata = await ctx.db.get(metadataId);
    if (!metadata) {
      throw new Error(`Metadata ${metadataId} not found`);
    }

    // Update metadata with extracted data
    await ctx.db.patch(metadataId, {
      event_score: extractedData.event_score ?? 0,
      event_date_start: extractedData.event_date_start,
      event_date_end: extractedData.event_date_end,
      event_time_start: extractedData.event_time_start,
      event_time_end: extractedData.event_time_end,
      location: extractedData.location,
      location_address: extractedData.location_address,
      location_coordinates: extractedData.location_coordinates,
      event_type: extractedData.event_type,
      event_title: extractedData.event_title,
      organizer_name: extractedData.organizer_name,
      organizer_contact: extractedData.organizer_contact,
      target_audience: extractedData.target_audience,
      registration_required: extractedData.registration_required,
      registration_url: extractedData.registration_url,
      ticket_price: extractedData.ticket_price,
      event_description: extractedData.event_description,
      hashtags: extractedData.hashtags,
      keywords: extractedData.keywords,
      language: extractedData.language,
      content_type: extractedData.content_type,
      telegram_message: telegramMessage,
      processing_status: "completed",
      processing_completed_at: now,
      processing_error: undefined,
      ai_model_used: aiModelUsed,
      agent_thread_id: agentThreadId,
    });

    // Link metadata to post
    await ctx.db.patch(metadata.post_id, { metadata_id: metadataId });
  },
});

/**
 * Internal mutation to mark metadata as failed
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
      processing_completed_at: Date.now(),
      processing_error: error,
    });
  },
});

const MAX_RETRIES = 3;
const AI_MODEL_USED = "gemini-2.0-flash-exp";

type WorkflowStep = Parameters<
  Parameters<typeof workflow.define>[0]["handler"]
>[0];

/**
 * Extract metadata from post with retry logic
 */
async function extractMetadataWithRetry(
  step: WorkflowStep,
  caption: string,
  postUrl: string
): Promise<PostMetadataExtraction> {
  const extractAction = extractPostMetadata as unknown as FunctionReference<
    "action",
    "internal"
  >;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await step.runAction(
        extractAction,
        { caption, postUrl },
        { retry: attempt < MAX_RETRIES }
      );
    } catch (error) {
      const lastError =
        error instanceof Error ? error : new Error(String(error));
      if (attempt >= MAX_RETRIES) {
        throw lastError;
      }
    }
  }

  throw new Error("Failed to extract metadata after retries");
}

/**
 * Generate Telegram message, returning undefined on failure
 */
async function generateTelegramMessageSafe(
  step: WorkflowStep,
  metadata: PostMetadataExtraction,
  postUrl: string
): Promise<string | undefined> {
  try {
    const generateAction =
      generateTelegramMessage as unknown as FunctionReference<
        "action",
        "internal"
      >;
    return await step.runAction(generateAction, { metadata, postUrl });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to generate Telegram message:", errorMessage);
    return;
  }
}

/**
 * Handle workflow error by marking metadata as failed
 */
async function handleWorkflowError(
  step: WorkflowStep,
  metadataId: Id<"post_metadata"> | undefined,
  error: unknown
): Promise<{
  success: false;
  metadataId: Id<"post_metadata"> | undefined;
  error: string;
}> {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (metadataId) {
    const markFailed = markMetadataFailed as unknown as FunctionReference<
      "mutation",
      "internal"
    >;
    await step.runMutation(markFailed, { metadataId, error: errorMessage });
  }

  return {
    success: false,
    metadataId,
    error: errorMessage,
  };
}

/**
 * Workflow to process post metadata extraction
 */
export const processPostMetadata = workflow.define({
  args: { postId: v.id("posts") },
  returns: v.object({
    success: v.boolean(),
    metadataId: v.optional(v.id("post_metadata")),
    error: v.optional(v.string()),
  }),
  handler: async (step, { postId }) => {
    let metadataId: Id<"post_metadata"> | undefined;

    try {
      // Step 1: Create or get metadata record
      const createMetadata =
        createOrGetMetadata as unknown as FunctionReference<
          "mutation",
          "internal"
        >;
      metadataId = await step.runMutation(createMetadata, { postId });

      // Step 2: Load post data
      const getPost = getPostData as unknown as FunctionReference<
        "query",
        "internal"
      >;
      const post = await step.runQuery(getPost, { postId });

      // Step 3: Extract metadata via agent (with retry)
      const extractedData = await extractMetadataWithRetry(
        step,
        post.caption,
        post.url
      );

      // Step 4: Generate Telegram message (non-critical)
      const telegramMessage = await generateTelegramMessageSafe(
        step,
        extractedData,
        post.url
      );

      // Step 5: Save metadata and link to post
      const save = saveMetadata as unknown as FunctionReference<
        "mutation",
        "internal"
      >;
      await step.runMutation(save, {
        metadataId,
        extractedData,
        telegramMessage,
        agentThreadId: undefined,
        aiModelUsed: AI_MODEL_USED,
      });

      return {
        success: true,
        metadataId,
      };
    } catch (error) {
      return await handleWorkflowError(step, metadataId, error);
    }
  },
});
