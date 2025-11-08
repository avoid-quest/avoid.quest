import {
  generateText,
  InvalidArgumentError,
  InvalidPromptError,
  InvalidResponseDataError,
} from "ai";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { formatEventDateRange, formatEventTime } from "../lib/dateUtils";
import { getGroqModel } from "./config";
import {
  type PostMetadataExtraction,
  postMetadataValidator,
  postMetadataZodSchema,
} from "./postMetadataExtractorAgent";
import {
  buildTelegramMessagePrompt,
  getTelegramMessageGenerationSystemPrompt,
} from "./prompts";

const MAX_TELEGRAM_MESSAGE_LENGTH = 1024;
const ELLIPSIS_LENGTH = 3;
const MIN_TRUNCATION_THRESHOLD = 0.7;

/**
 * Build basic event info (title, description)
 */
function buildBasicInfo(metadata: PostMetadataExtraction): string[] {
  const parts: string[] = [];
  if (metadata.event_title) {
    parts.push(`Titolo: ${metadata.event_title}`);
  }
  if (metadata.event_description) {
    parts.push(`Descrizione: ${metadata.event_description}`);
  }
  return parts;
}

/**
 * Build date and time info
 */
function buildDateTimeInfo(metadata: PostMetadataExtraction): string[] {
  const parts: string[] = [];
  const dateRange = formatEventDateRange(
    metadata.event_date_start,
    metadata.event_date_end
  );
  if (dateRange) {
    parts.push(`Data: ${dateRange}`);
  }

  const timeRange = formatEventTime(
    metadata.event_time_start,
    metadata.event_time_end
  );
  if (timeRange) {
    parts.push(`Orario: ${timeRange}`);
  }
  return parts;
}

/**
 * Build location info
 */
function buildLocationInfo(metadata: PostMetadataExtraction): string[] {
  const parts: string[] = [];
  if (metadata.location) {
    parts.push(`Luogo: ${metadata.location}`);
  }
  return parts;
}

/**
 * Build pricing and registration info
 */
function buildPricingInfo(metadata: PostMetadataExtraction): string[] {
  const parts: string[] = [];
  if (metadata.ticket_price) {
    parts.push(`Prezzo: ${metadata.ticket_price}`);
  }
  if (metadata.registration_required !== undefined) {
    parts.push(
      `Registrazione: ${metadata.registration_required ? "Richiesta" : "Non richiesta"}`
    );
  }
  if (metadata.registration_url) {
    parts.push(`URL Registrazione: ${metadata.registration_url}`);
  }
  return parts;
}

/**
 * Build organizer info
 */
function buildOrganizerInfo(metadata: PostMetadataExtraction): string[] {
  const parts: string[] = [];
  if (metadata.organizer_name) {
    parts.push(`Organizzatore: ${metadata.organizer_name}`);
  }
  return parts;
}

/**
 * Build additional info (type, hashtags)
 */
function buildAdditionalInfo(metadata: PostMetadataExtraction): string[] {
  const parts: string[] = [];
  if (metadata.event_type) {
    parts.push(`Tipo evento: ${metadata.event_type}`);
  }
  if (metadata.hashtags && metadata.hashtags.length > 0) {
    parts.push(`Hashtag: ${metadata.hashtags.join(", ")}`);
  }
  return parts;
}

/**
 * Build event details string for prompt (Italian format)
 */
function buildEventDetailsString(metadata: PostMetadataExtraction): string {
  const parts: string[] = [
    ...buildBasicInfo(metadata),
    ...buildDateTimeInfo(metadata),
    ...buildLocationInfo(metadata),
    ...buildPricingInfo(metadata),
    ...buildOrganizerInfo(metadata),
    ...buildAdditionalInfo(metadata),
  ];

  return parts.join("\n");
}

/**
 * Truncate message preserving sentence boundaries
 */
function truncateMessage(message: string, instagramLink: string): string {
  if (message.length <= MAX_TELEGRAM_MESSAGE_LENGTH) {
    return message;
  }

  const truncated = message.substring(
    0,
    MAX_TELEGRAM_MESSAGE_LENGTH - ELLIPSIS_LENGTH
  );
  const minTruncationPoint =
    MAX_TELEGRAM_MESSAGE_LENGTH * MIN_TRUNCATION_THRESHOLD;

  // Try to find sentence boundary
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("!"),
    truncated.lastIndexOf("?")
  );

  if (lastSentenceEnd > minTruncationPoint) {
    return `${message.substring(0, lastSentenceEnd + 1)}...\n\n${instagramLink}`;
  }

  // Fall back to word boundary
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > minTruncationPoint) {
    return `${message.substring(0, lastSpace)}...\n\n${instagramLink}`;
  }

  return `${truncated}...\n\n${instagramLink}`;
}

/**
 * Ensure message ends with Instagram link
 */
function ensureInstagramLink(message: string, postUrl: string): string {
  const instagramLink = `<a href="${postUrl}">View on Instagram</a>`;

  if (!message.includes(instagramLink)) {
    return `${message}\n\n${instagramLink}`;
  }

  return message;
}

/**
 * Validate metadata using Zod schema
 */
function validateMetadata(metadata: unknown): void {
  const validationResult = postMetadataZodSchema.safeParse(metadata);
  if (!validationResult.success) {
    throw new InvalidArgumentError({
      parameter: "metadata",
      value: metadata,
      message: validationResult.error.message,
    });
  }
}

/**
 * Validate postUrl
 */
function validatePostUrl(postUrl: unknown): void {
  if (postUrl === undefined || postUrl === null) {
    return;
  }

  if (typeof postUrl !== "string" || postUrl.length === 0) {
    throw new InvalidArgumentError({
      parameter: "postUrl",
      value: postUrl,
      message: "Post URL must be a non-empty string",
    });
  }

  try {
    new URL(postUrl);
  } catch {
    throw new InvalidArgumentError({
      parameter: "postUrl",
      value: postUrl,
      message: "Post URL must be a valid URL",
    });
  }
}

/**
 * Generate text using AI model with proper error handling
 */
async function generateTextWithModel(
  model: ReturnType<typeof getGroqModel>,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
    });
    return result.text;
  } catch (error) {
    // Re-throw AI SDK errors as-is
    if (
      InvalidPromptError.isInstance(error) ||
      InvalidResponseDataError.isInstance(error) ||
      InvalidArgumentError.isInstance(error)
    ) {
      throw error;
    }
    // Wrap other errors
    throw new InvalidResponseDataError({
      data: undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Process generated text: trim, add link, truncate
 */
function processMessage(text: string, postUrl: string): string {
  let message = text.trim();
  message = ensureInstagramLink(message, postUrl);
  message = truncateMessage(
    message,
    `<a href="${postUrl}">View on Instagram</a>`
  );
  return message;
}

/**
 * Generate a Telegram-formatted message from extracted metadata
 */
export const generateTelegramMessage = internalAction({
  args: {
    metadata: postMetadataValidator,
    postUrl: v.string(),
    originalCaption: v.string(),
  },
  returns: v.string(),
  handler: async (_ctx, { metadata, postUrl, originalCaption }) => {
    try {
      // Validate inputs
      validateMetadata(metadata);
      validatePostUrl(postUrl);

      // Get Groq model and build prompts
      const model = getGroqModel();
      const eventDetails = buildEventDetailsString(metadata);
      const userPrompt = buildTelegramMessagePrompt(
        eventDetails,
        postUrl,
        originalCaption,
        MAX_TELEGRAM_MESSAGE_LENGTH
      );
      const systemPrompt = getTelegramMessageGenerationSystemPrompt(
        MAX_TELEGRAM_MESSAGE_LENGTH,
        postUrl
      );

      // Generate and process message
      const text = await generateTextWithModel(model, systemPrompt, userPrompt);
      return processMessage(text, postUrl);
    } catch (error) {
      // Re-throw AI SDK errors as-is
      if (
        InvalidArgumentError.isInstance(error) ||
        InvalidPromptError.isInstance(error) ||
        InvalidResponseDataError.isInstance(error)
      ) {
        throw error;
      }
      // Wrap unknown errors
      throw new InvalidArgumentError({
        parameter: "telegramMessageGeneration",
        value: { metadata, postUrl },
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },
});
