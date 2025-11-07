import { google } from "@ai-sdk/google";
import { Agent } from "@convex-dev/agent";
import { v } from "convex/values";
import { z } from "zod";
import { components } from "../_generated/api";
import { internalAction } from "../_generated/server";

const MIN_EVENT_SCORE = 0;
const MAX_EVENT_SCORE = 100;

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
  registration_url: z.string().url().optional(),
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

const SYSTEM_INSTRUCTIONS = `You are an expert at extracting event-related information from Instagram post captions.

Your task is to analyze the post caption and extract structured metadata about events. An "event" is defined as any gathering, performance, workshop, meetup, concert, conference, festival, exhibition, or similar activity that happens at a specific time and/or location.

Key extraction guidelines:
1. **Event Score (0-100)**: Determine how confident you are that this post describes an event. Use 0-30 for non-events, 31-60 for possibly related content, 61-80 for likely events, and 81-100 for clear event announcements.

2. **Date/Time Parsing**: 
   - Assume Rome/Italy timezone (UTC+1/UTC+2) for event dates unless explicitly stated otherwise
   - Extract both start and end dates for multi-day events
   - Extract times in the format provided (e.g., "19:00", "7:00 PM")
   - Convert relative dates (e.g., "tomorrow", "next Friday") to absolute timestamps

3. **Location**: Extract venue names, addresses, and if possible, geocoded coordinates. Prefer full addresses when available.

4. **Event Type**: Classify as: concert, workshop, conference, festival, exhibition, meetup, or other.

5. **Content Type**: Determine if this is an event_announcement (promoting upcoming event), event_reminder (reminder about upcoming event), event_recap (summary of past event), or other.

6. **Extract all relevant details**: organizer info, registration requirements, ticket prices, target audience, hashtags, keywords, and language.

7. **Be thorough but accurate**: Only extract information that is clearly stated or strongly implied in the caption. Don't make assumptions.

Output the extracted metadata in the structured format provided.`;

/**
 * Create and configure the post metadata extractor agent
 */
function createPostMetadataExtractorAgent(): Agent {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY environment variable is required"
    );
  }

  const model = google("gemini-2.0-flash-exp");

  return new Agent(components.agent, {
    name: "Post Metadata Extractor",
    languageModel: model,
    instructions: SYSTEM_INSTRUCTIONS,
  });
}

/**
 * Extract metadata from a post caption using the agent
 */
export const extractPostMetadata = internalAction({
  args: {
    caption: v.string(),
    postUrl: v.optional(v.string()),
  },
  returns: postMetadataValidator,
  handler: async (ctx, { caption, postUrl }) => {
    const agent = createPostMetadataExtractorAgent();

    const prompt = `Analyze this Instagram post caption and extract event-related metadata:

${caption}

${postUrl ? `Post URL: ${postUrl}` : ""}

Extract all relevant event information including dates, times, location, event type, organizer details, and any other relevant metadata.`;

    // Create a temporary thread for this extraction
    const { thread } = await agent.createThread(ctx, {
      title: "Post Metadata Extraction",
    });

    // Generate structured object using the thread
    const result = await thread.generateObject({
      prompt,
      schema: postMetadataZodSchema,
    });

    return result.object;
  },
});
