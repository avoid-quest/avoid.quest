import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { postMetadataValidator } from "./postMetadataExtractorAgent";

const MAX_TELEGRAM_MESSAGE_LENGTH = 1024;
const ELLIPSIS_LENGTH = 3;
const MIN_TRUNCATION_THRESHOLD = 0.7;

/**
 * Format event date for display
 */
function formatEventDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("it-IT", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Build event details string for prompt
 */
function buildEventDetailsString(metadata: {
  event_title?: string;
  event_description?: string;
  event_date_start?: number;
  event_time_start?: string;
  location?: string;
  location_address?: string;
  ticket_price?: string;
  registration_url?: string;
  organizer_name?: string;
  hashtags?: string[];
}): string {
  const parts: string[] = [];

  if (metadata.event_title) {
    parts.push(`Title: ${metadata.event_title}`);
  }
  if (metadata.event_description) {
    parts.push(`Description: ${metadata.event_description}`);
  }
  if (metadata.event_date_start) {
    parts.push(`Date: ${formatEventDate(metadata.event_date_start)}`);
  }
  if (metadata.event_time_start) {
    parts.push(`Time: ${metadata.event_time_start}`);
  }
  if (metadata.location) {
    parts.push(`Location: ${metadata.location}`);
  }
  if (metadata.location_address) {
    parts.push(`Address: ${metadata.location_address}`);
  }
  if (metadata.ticket_price) {
    parts.push(`Price: ${metadata.ticket_price}`);
  }
  if (metadata.registration_url) {
    parts.push(`Registration: ${metadata.registration_url}`);
  }
  if (metadata.organizer_name) {
    parts.push(`Organizer: ${metadata.organizer_name}`);
  }
  if (metadata.hashtags && metadata.hashtags.length > 0) {
    parts.push(`Hashtags: ${metadata.hashtags.join(", ")}`);
  }

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
 * Generate a Telegram-formatted message from extracted metadata
 */
export const generateTelegramMessage = internalAction({
  args: {
    metadata: postMetadataValidator,
    postUrl: v.string(),
  },
  returns: v.string(),
  handler: async (_ctx, { metadata, postUrl }) => {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      throw new Error(
        "GOOGLE_GENERATIVE_AI_API_KEY environment variable is required"
      );
    }

    const model = google("gemini-2.0-flash-exp");
    const eventDetails = buildEventDetailsString(metadata);

    const prompt = `Generate a Telegram message caption for an Instagram post about an event. The message should:

1. Be formatted using Telegram HTML formatting (<b>bold</b>, <i>italic</i>, <a href="url">link</a>)
2. Be engaging and informative
3. Include key event details: title, date/time, location, price, registration info
4. End with an Instagram link: <a href="${postUrl}">View on Instagram</a>
5. Be maximum ${MAX_TELEGRAM_MESSAGE_LENGTH} characters (including the Instagram link)
6. Preserve sentence/word boundaries when truncating if needed
7. Use proper HTML escaping for special characters

Event details:
${eventDetails}

Generate the message now:`;

    const { text } = await generateText({
      model,
      prompt,
    });

    let message = text.trim();
    message = ensureInstagramLink(message, postUrl);
    message = truncateMessage(
      message,
      `<a href="${postUrl}">View on Instagram</a>`
    );

    return message;
  },
});
