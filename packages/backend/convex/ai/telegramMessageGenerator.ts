import { generateText } from "ai";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { getAIModelFromSettings } from "./config";
import { postMetadataValidator } from "./postMetadataExtractorAgent";
import {
  buildTelegramMessagePrompt,
  getTelegramMessageGenerationSystemPrompt,
} from "./prompts";

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
 * Format event time for display
 */
function formatEventTime(timeStart?: string, timeEnd?: string): string {
  if (!timeStart) {
    return "";
  }
  if (timeEnd) {
    return `dalle ${timeStart} alle ${timeEnd}`;
  }
  return timeStart;
}

/**
 * Format event date range for display
 */
function formatEventDateRange(dateStart?: number, dateEnd?: number): string {
  if (!dateStart) {
    return "";
  }
  if (dateEnd && dateEnd !== dateStart) {
    const startDate = formatEventDate(dateStart);
    const endDate = formatEventDate(dateEnd);
    return `dal ${startDate} al ${endDate}`;
  }
  return formatEventDate(dateStart);
}

type EventMetadata = {
  event_title?: string;
  event_description?: string;
  event_date_start?: number;
  event_date_end?: number;
  event_time_start?: string;
  event_time_end?: string;
  location?: string;
  location_address?: string;
  ticket_price?: string;
  registration_url?: string;
  registration_required?: boolean;
  organizer_name?: string;
  organizer_contact?: string;
  target_audience?: string[];
  hashtags?: string[];
  event_type?: string;
};

/**
 * Build basic event info (title, description)
 */
function buildBasicInfo(metadata: EventMetadata): string[] {
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
function buildDateTimeInfo(metadata: EventMetadata): string[] {
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
function buildLocationInfo(metadata: EventMetadata): string[] {
  const parts: string[] = [];
  if (metadata.location) {
    parts.push(`Luogo: ${metadata.location}`);
  }
  if (metadata.location_address) {
    parts.push(`Indirizzo: ${metadata.location_address}`);
  }
  return parts;
}

/**
 * Build pricing and registration info
 */
function buildPricingInfo(metadata: EventMetadata): string[] {
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
function buildOrganizerInfo(metadata: EventMetadata): string[] {
  const parts: string[] = [];
  if (metadata.organizer_name) {
    parts.push(`Organizzatore: ${metadata.organizer_name}`);
  }
  if (metadata.organizer_contact) {
    parts.push(`Contatto: ${metadata.organizer_contact}`);
  }
  return parts;
}

/**
 * Build additional info (audience, type, hashtags)
 */
function buildAdditionalInfo(metadata: EventMetadata): string[] {
  const parts: string[] = [];
  if (metadata.target_audience && metadata.target_audience.length > 0) {
    parts.push(`Pubblico target: ${metadata.target_audience.join(", ")}`);
  }
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
function buildEventDetailsString(metadata: EventMetadata): string {
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
 * Generate a Telegram-formatted message from extracted metadata
 */
export const generateTelegramMessage = internalAction({
  args: {
    metadata: postMetadataValidator,
    postUrl: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, { metadata, postUrl }) => {
    // Get model from settings or use default
    const { model } = await getAIModelFromSettings(ctx);
    const eventDetails = buildEventDetailsString(metadata);

    const userPrompt = buildTelegramMessagePrompt(
      eventDetails,
      postUrl,
      MAX_TELEGRAM_MESSAGE_LENGTH
    );

    const systemPrompt = getTelegramMessageGenerationSystemPrompt(
      MAX_TELEGRAM_MESSAGE_LENGTH,
      postUrl
    );

    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
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
