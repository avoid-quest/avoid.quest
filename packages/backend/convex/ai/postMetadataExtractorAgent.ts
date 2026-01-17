import { Agent } from "@convex-dev/agent";
import { InvalidArgumentError } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { components } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { getGroqModel } from "./config";
import {
	buildPostMetadataExtractionPrompt,
	POST_METADATA_EXTRACTION_SYSTEM_PROMPT,
} from "./prompts";

const MIN_EVENT_SCORE = 0;
const MAX_EVENT_SCORE = 100;

// Zod schema for AI extraction - single source of truth
// Simplified schema: removed unused/redundant fields
export const postMetadataZodSchema = z.object({
	event_score: z.number().min(MIN_EVENT_SCORE).max(MAX_EVENT_SCORE),
	event_date_start: z.number().optional(),
	event_date_end: z.number().optional(),
	event_time_start: z.string().optional(),
	event_time_end: z.string().optional(),
	location: z.string().optional(), // Unified location field (venue + address + city)
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
	registration_required: z.boolean().optional(),
	registration_url: z.string().optional(),
	ticket_price: z.string().optional(),
	event_description: z.string().optional(),
	hashtags: z.array(z.string()).optional(),
	language: z.string().optional(),
});

export type PostMetadataExtraction = z.infer<typeof postMetadataZodSchema>;

// Convex validator derived from Zod schema structure
// This matches the Zod schema exactly - both defined together to keep in sync
export const postMetadataValidator = v.object({
	event_score: v.number(),
	event_date_start: v.optional(v.number()),
	event_date_end: v.optional(v.number()),
	event_time_start: v.optional(v.string()),
	event_time_end: v.optional(v.string()),
	location: v.optional(v.string()), // Unified location field
	event_type: v.optional(
		v.union(
			v.literal("concert"),
			v.literal("workshop"),
			v.literal("conference"),
			v.literal("festival"),
			v.literal("exhibition"),
			v.literal("meetup"),
			v.literal("other"),
		),
	),
	event_title: v.optional(v.string()),
	organizer_name: v.optional(v.string()),
	registration_required: v.optional(v.boolean()),
	registration_url: v.optional(v.string()),
	ticket_price: v.optional(v.string()),
	event_description: v.optional(v.string()),
	hashtags: v.optional(v.array(v.string())),
	language: v.optional(v.string()),
});

function createAgent(model: ReturnType<typeof getGroqModel>): Agent {
	return new Agent(components.agent, {
		name: "Post Metadata Extractor",
		languageModel: model,
		instructions: POST_METADATA_EXTRACTION_SYSTEM_PROMPT,
	});
}

/**
 * Extract metadata from a post caption using AI
 * Uses agent.asObjectAction pattern internally for structured output
 * Each extraction gets its own isolated thread for proper context separation
 */
export const extractPostMetadata = internalAction({
	args: {
		postId: v.id("posts"),
		caption: v.string(),
		postUrl: v.optional(v.string()),
		timestamp: v.optional(v.number()),
	},
	returns: v.object({
		extractedData: postMetadataValidator,
		threadId: v.string(),
	}),
	handler: async (
		ctx,
		{ postId, caption, postUrl, timestamp },
	): Promise<{ extractedData: PostMetadataExtraction; threadId: string }> => {
		// Validate caption using AI SDK error pattern
		if (!caption || caption.trim().length === 0) {
			throw new InvalidArgumentError({
				parameter: "caption",
				value: caption,
				message: "Caption is required and cannot be empty",
			});
		}

		try {
			// Get Groq model
			const model = getGroqModel();
			const agent = createAgent(model);

			// Create unique thread for this post extraction (ensures isolation)
			// Thread title includes postId for easy identification and debugging
			const thread = await agent.createThread(ctx, {
				title: `Post Metadata Extraction: ${postId}`,
			});

			// Build prompt (timestamp is already in milliseconds from workflow)
			const prompt = buildPostMetadataExtractionPrompt(
				caption,
				postUrl,
				timestamp,
			);

			// Generate structured object - Agent handles validation automatically
			const result = await agent.generateObject(
				ctx,
				{ threadId: thread.threadId },
				{
					prompt,
					schema: postMetadataZodSchema,
				},
			);

			// Return validated object with thread ID for tracking
			// Each post gets its own isolated thread context
			return {
				extractedData: result.object,
				threadId: thread.threadId,
			};
		} catch (error) {
			// Re-throw AI SDK errors as-is
			if (InvalidArgumentError.isInstance(error)) {
				throw error;
			}
			// Wrap other errors
			throw new InvalidArgumentError({
				parameter: "extraction",
				value: { caption, postUrl, timestamp },
				message: error instanceof Error ? error.message : String(error),
			});
		}
	},
});
