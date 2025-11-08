import { NoObjectGeneratedError } from "ai";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { getAIModelFromSettings, getModelIdentifier } from "../ai/config";
import type { PostMetadataExtraction } from "../ai/postMetadataExtractorAgent";
import { postMetadataValidator } from "../ai/postMetadataExtractorAgent";
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
      ...(agentThreadId ? { agent_thread_id: agentThreadId } : {}),
      ai_model_used: aiModelUsed,
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

const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const DEFAULT_QUOTA_RETRY_DELAY_MS = SECONDS_PER_MINUTE * MS_PER_SECOND; // Default 60 seconds if we can't parse the retry time
const RETRY_BUFFER_MULTIPLIER = 1.1; // Add 10% buffer to retry delays
const MS_THRESHOLD_FOR_SECONDS = 1000; // If retryAfter < 1000, assume it's in seconds

// Regex patterns for extracting retry delays from error messages (defined at top level for performance)
const RETRY_DELAY_PATTERNS = [
  /try again in ([\d.]+)s/i, // Groq format: "Please try again in 35.436s"
  /retry in ([\d.]+)s/i,
  /retry after ([\d.]+)s/i,
  /retry_after[:\s]+([\d.]+)/i,
  /retry after ([\d.]+) seconds/i,
  /try again after ([\d.]+)s/i,
] as const;

// Pattern for parsing our custom RATE_LIMIT_RETRY error format
const RATE_LIMIT_RETRY_PATTERN = /^RATE_LIMIT_RETRY:(\d+):/;

type WorkflowStep = Parameters<
  Parameters<typeof workflow.define>[0]["handler"]
>[0];

/**
 * Check if error is a quota/rate limit error
 * Handles errors from AI SDK and Groq API
 */
function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  // Check for common rate limit/quota error messages
  const hasQuotaKeywords =
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("rate_limit") ||
    message.includes("exceeded your current quota") ||
    message.includes("resource exhausted") ||
    message.includes("429") || // HTTP 429 Too Many Requests
    message.includes("too many requests");

  // Check if error has status code property (common in HTTP errors)
  const HTTP_TOO_MANY_REQUESTS = 429;
  const errorAny = error as Error & { statusCode?: number; status?: number };
  const has429Status =
    errorAny.statusCode === HTTP_TOO_MANY_REQUESTS ||
    errorAny.status === HTTP_TOO_MANY_REQUESTS;

  // Check error name for rate limit indicators
  const hasRateLimitName =
    error.name === "RateLimitError" ||
    error.name === "QuotaExceededError" ||
    error.name === "429";

  return hasQuotaKeywords || has429Status || hasRateLimitName;
}

/**
 * Extract retry delay from quota error message
 * Returns delay in milliseconds, or null if not found
 * Handles multiple formats from AI providers:
 * - Groq: "Please try again in 35.436s"
 * - Generic: "retry after 60s", "retry_after: 30"
 * Also checks for retryAfter property in error object
 */
function extractRetryDelayFromError(error: Error): number | null {
  // Check for retryAfter property in error object (common in HTTP errors)
  const errorAny = error as Error & {
    retryAfter?: number;
    retry_after?: number;
    retryAfterMs?: number;
    cause?: Error | unknown;
  };

  if (errorAny.retryAfter !== undefined && errorAny.retryAfter > 0) {
    // If in seconds, convert to ms
    return errorAny.retryAfter < MS_THRESHOLD_FOR_SECONDS
      ? errorAny.retryAfter * MS_PER_SECOND
      : errorAny.retryAfter;
  }

  if (errorAny.retry_after !== undefined && errorAny.retry_after > 0) {
    return errorAny.retry_after < MS_THRESHOLD_FOR_SECONDS
      ? errorAny.retry_after * MS_PER_SECOND
      : errorAny.retry_after;
  }

  if (errorAny.retryAfterMs !== undefined && errorAny.retryAfterMs > 0) {
    return errorAny.retryAfterMs;
  }

  // Try to extract from error message
  const extractFromMessage = (msg: string): number | null => {
    for (const pattern of RETRY_DELAY_PATTERNS) {
      const match = msg.match(pattern);
      if (match?.[1]) {
        const seconds = Number.parseFloat(match[1]);
        if (!Number.isNaN(seconds) && seconds > 0) {
          // Add buffer and round up to nearest second, then convert to ms
          return Math.ceil(seconds * RETRY_BUFFER_MULTIPLIER) * MS_PER_SECOND;
        }
      }
    }
    return null;
  };

  // First try the main error message
  const delayFromMessage = extractFromMessage(error.message);
  if (delayFromMessage !== null) {
    return delayFromMessage;
  }

  // If not found, check the cause chain (for wrapped errors like AI_RetryError)
  if (errorAny.cause instanceof Error) {
    const delayFromCause = extractFromMessage(errorAny.cause.message);
    if (delayFromCause !== null) {
      return delayFromCause;
    }
  }

  return null;
}

/**
 * Helper action to reschedule a workflow after a delay
 * This is used when we hit rate limits and need to retry later
 * Uses the scheduler to reschedule the workflow based on AI response delay
 */
export const rescheduleWorkflow = internalAction({
  args: {
    postId: v.id("posts"),
    delayMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { postId, delayMs }) => {
    console.log(
      `Rescheduling workflow for post ${postId} after ${delayMs}ms delay (from AI response)`
    );
    await ctx.scheduler.runAfter(
      delayMs,
      internal.workflows.postMetadata.startWorkflow,
      { postId }
    );
    return null;
  },
});

/**
 * Action to start the workflow (used for rescheduling)
 */
export const startWorkflow = internalAction({
  args: { postId: v.id("posts") },
  returns: v.null(),
  handler: async (ctx, { postId }) => {
    await workflow.start(
      ctx,
      internal.workflows.postMetadata.processPostMetadata,
      { postId }
    );
    return null;
  },
});

/**
 * Extract metadata from post
 * On rate limit errors, throws a special error with retry delay extracted from AI response
 */
async function extractMetadata(
  step: WorkflowStep,
  caption: string,
  postUrl: string,
  timestamp: number
): Promise<PostMetadataExtraction> {
  try {
    // Use built-in retry for transient errors, but we'll handle rate limits specially
    return await step.runAction(
      internal.ai.postMetadataExtractorAgent.extractPostMetadata,
      { caption, postUrl, timestamp },
      { retry: false } // Disable automatic retry, we handle rate limits with rescheduling
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : "UnknownError";

    // Use AI SDK's proper error detection
    const isNoObjectError = NoObjectGeneratedError.isInstance(error);
    const isQuota = isQuotaError(error);

    // Extract additional error properties for logging
    const errorAny = error as Error & {
      statusCode?: number;
      status?: number;
      retryAfter?: number;
      retry_after?: number;
      cause?: unknown;
    };

    console.error("Metadata extraction failed:", {
      errorName,
      errorMessage,
      isNoObjectError,
      isQuota,
      statusCode: errorAny.statusCode,
      status: errorAny.status,
      retryAfter: errorAny.retryAfter,
      retry_after: errorAny.retry_after,
      cause: errorAny.cause,
    });

    // If it's a quota error, extract the retry delay from AI response and signal reschedule
    if (isQuota) {
      const errorObj = error instanceof Error ? error : new Error(errorMessage);
      const retryDelayMs =
        extractRetryDelayFromError(errorObj) ?? DEFAULT_QUOTA_RETRY_DELAY_MS;

      console.log(
        `Rate limit detected (${errorName}). Will reschedule after ${retryDelayMs}ms (extracted from AI response)`
      );

      // Throw a special error that includes the delay for the workflow handler to process
      const rescheduleError = new Error(
        `RATE_LIMIT_RETRY:${retryDelayMs}:${errorMessage}`
      );
      // Preserve the original error name and stack
      rescheduleError.name = errorName;
      if (error instanceof Error && error.stack) {
        rescheduleError.stack = error.stack;
      }
      throw rescheduleError;
    }

    // For other errors, just throw them
    throw error;
  }
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
    return await step.runAction(
      internal.ai.telegramMessageGenerator.generateTelegramMessage,
      { metadata, postUrl }
    );
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
    await step.runMutation(internal.workflows.postMetadata.markMetadataFailed, {
      metadataId,
      error: errorMessage,
    });
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
  handler: async (
    step,
    { postId }
  ): Promise<{
    success: boolean;
    metadataId?: Id<"post_metadata">;
    error?: string;
  }> => {
    let metadataId: Id<"post_metadata"> | undefined;

    try {
      // Step 1: Create or get metadata record
      metadataId = await step.runMutation(
        internal.workflows.postMetadata.createOrGetMetadata,
        { postId }
      );

      // Step 2: Load post data
      const post = await step.runQuery(
        internal.workflows.postMetadata.getPostData,
        { postId }
      );

      // Step 3: Extract metadata via agent
      // If rate limited, this will throw an error with retry delay info
      let extractedData: PostMetadataExtraction;
      try {
        extractedData = await extractMetadata(
          step,
          post.caption,
          post.url,
          post.timestamp
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Check if this is a rate limit error with retry delay
        const rateLimitMatch = errorMessage.match(RATE_LIMIT_RETRY_PATTERN);
        if (rateLimitMatch) {
          const delayMs = Number.parseInt(rateLimitMatch[1], 10);
          console.log(
            `Rate limit detected. Rescheduling workflow for post ${postId} after ${delayMs}ms`
          );

          // Reschedule the workflow using an action (actions have scheduler access)
          await step.runAction(
            internal.workflows.postMetadata.rescheduleWorkflow,
            {
              postId,
              delayMs,
            }
          );

          // Return early - the workflow will be rescheduled
          return {
            success: false,
            metadataId,
            error: `Rate limited. Rescheduled for retry in ${delayMs}ms`,
          };
        }

        // Re-throw other errors
        throw error;
      }

      // Step 4: Generate Telegram message (non-critical)
      const telegramMessage = await generateTelegramMessageSafe(
        step,
        extractedData,
        post.url
      );

      // Step 5: Save metadata and link to post
      if (!metadataId) {
        throw new Error("Metadata ID is undefined");
      }

      // Get the model identifier from settings for storage
      const modelConfig = await getAIModelFromSettings(step);
      const aiModelUsed = getModelIdentifier(modelConfig);

      await step.runMutation(internal.workflows.postMetadata.saveMetadata, {
        metadataId,
        extractedData,
        telegramMessage,
        // agentThreadId omitted - optional field
        aiModelUsed,
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
