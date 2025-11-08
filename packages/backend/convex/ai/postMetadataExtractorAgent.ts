import { Agent } from "@convex-dev/agent";
import { NoObjectGeneratedError } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { components } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { getAIModelFromSettings } from "./config";
import {
  buildPostMetadataExtractionPrompt,
  POST_METADATA_EXTRACTION_SYSTEM_PROMPT,
} from "./prompts";

const MIN_EVENT_SCORE = 0;
const MAX_EVENT_SCORE = 100;
const CAPTION_PREVIEW_LENGTH = 200;

// Zod schema for AI extraction (used internally by agent)
const postMetadataZodSchema = z.object({
  event_score: z.number().min(MIN_EVENT_SCORE).max(MAX_EVENT_SCORE),
  event_date_start: z.number().optional(),
  event_date_end: z.number().optional(),
  event_time_start: z.string().optional(),
  event_time_end: z.string().optional(),
  location: z.string().optional(),
  location_address: z.string().optional(),
  location_coordinates: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .optional(),
  event_type: z
    .enum([
      "concert",
      "workshop",
      "conference",
      "festival",
      "exhibition",
      "meetup",
      "other",
    ])
    .optional(),
  event_title: z.string().optional(),
  organizer_name: z.string().optional(),
  organizer_contact: z.string().optional(),
  target_audience: z.array(z.string()).optional(),
  registration_required: z.boolean().optional(),
  registration_url: z.union([z.string().url(), z.literal("")]).optional(),
  ticket_price: z.string().optional(),
  event_description: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  language: z.string().optional(),
  content_type: z
    .enum(["event_announcement", "event_reminder", "event_recap", "other"])
    .optional(),
});

export type PostMetadataExtraction = z.infer<typeof postMetadataZodSchema>;

// Convex validator for return type
export const postMetadataValidator = v.object({
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
});

/**
 * Create and configure the post metadata extractor agent
 * Uses centralized AI configuration to get the model from settings or defaults
 */
async function createPostMetadataExtractorAgent(
  ctx: Parameters<typeof getAIModelFromSettings>[0]
): Promise<Agent> {
  // Get model from settings or use default
  const { model } = await getAIModelFromSettings(ctx);

  return new Agent(components.agent, {
    name: "Post Metadata Extractor",
    languageModel: model,
    instructions: POST_METADATA_EXTRACTION_SYSTEM_PROMPT,
  });
}

/**
 * Extract metadata from a post caption using the agent
 */
export const extractPostMetadata = internalAction({
  args: {
    caption: v.string(),
    postUrl: v.optional(v.string()),
    timestamp: v.optional(v.number()),
  },
  returns: postMetadataValidator,
  handler: async (ctx, { caption, postUrl, timestamp }) => {
    const agent = await createPostMetadataExtractorAgent(ctx);

    const prompt = buildPostMetadataExtractionPrompt(
      caption,
      postUrl,
      timestamp
    );

    // Create a temporary thread for this extraction
    const { threadId } = await agent.createThread(ctx, {
      title: "Post Metadata Extraction",
    });

    try {
      // Generate structured object using agent.generateObject with threadId
      // This is the recommended pattern for workflows
      const result = await agent.generateObject(
        ctx,
        { threadId },
        {
          prompt,
          schema: postMetadataZodSchema,
        }
      );

      // Convert empty strings to undefined for optional URL fields
      // (Zod transforms can't be used in JSON Schema, so we handle this manually)
      const cleanedObject = {
        ...result.object,
        registration_url:
          result.object.registration_url === ""
            ? undefined
            : result.object.registration_url,
      };

      return cleanedObject;
    } catch (error) {
      // Truncate caption for logging
      const captionPreview =
        caption.length > CAPTION_PREVIEW_LENGTH
          ? `${caption.substring(0, CAPTION_PREVIEW_LENGTH)}...`
          : caption;

      // Use AI SDK's proper error detection
      if (NoObjectGeneratedError.isInstance(error)) {
        // Log detailed error information from AI SDK error object
        console.error(
          "NoObjectGeneratedError - Failed to extract post metadata:",
          {
            cause: error.cause,
            text: error.text,
            response: error.response,
            usage: error.usage,
            finishReason: error.finishReason,
            captionPreview,
            captionLength: caption.length,
            postUrl,
            timestamp,
            threadId,
          }
        );

        console.error(
          "AI model failed to generate a valid object. Possible reasons:",
          "- Model returned invalid JSON",
          "- Model response doesn't match schema",
          "- Model returned text instead of structured data",
          "- Caption may be too complex or ambiguous",
          `- Finish reason: ${error.finishReason ?? "unknown"}`
        );
      } else {
        // Handle other types of errors
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const errorName = error instanceof Error ? error.name : "UnknownError";

        console.error("Error extracting post metadata:", {
          errorName,
          errorMessage,
          captionPreview,
          captionLength: caption.length,
          postUrl,
          timestamp,
          threadId,
        });
      }

      // Re-throw the error so workflow retry logic can handle it
      throw error;
    }
  },
});
