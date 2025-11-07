import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { action } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

const MAX_TELEGRAM_MESSAGE_LENGTH = 1024;

async function generateTelegramMessageInternal(
  metadata: {
    event_score: number;
    event_date_start?: number;
    event_date_end?: number;
    event_time_start?: string;
    event_time_end?: string;
    location?: string;
    location_address?: string;
    location_coordinates?: { lat: number; lng: number };
    event_type?: "concert" | "workshop" | "conference" | "festival" | "exhibition" | "meetup" | "other";
    event_title?: string;
    organizer_name?: string;
    organizer_contact?: string;
    target_audience?: string[];
    registration_required?: boolean;
    registration_url?: string;
    ticket_price?: string;
    event_description?: string;
    hashtags?: string[];
    keywords?: string[];
    language?: string;
    content_type?: "event_announcement" | "event_reminder" | "event_recap" | "other";
  },
  postUrl: string
): Promise<string> {
  const prompt = `Generate a Telegram message caption for an Instagram post about an event.

**Extracted Metadata:**
${JSON.stringify(metadata, null, 2)}

**Requirements:**
1. Create engaging, concise text that highlights the key event information
2. Use Telegram HTML formatting: <b>bold</b>, <i>italic</i>, <a href="url">link</a>
3. Maximum length: ${MAX_TELEGRAM_MESSAGE_LENGTH} characters (including the Instagram link footer)
4. End with: \n\n<a href="${postUrl}">View on Instagram</a>
5. Preserve sentence/word boundaries - don't cut in the middle of words
6. Escape HTML entities properly (&amp;, &lt;, &gt;, &quot;)
7. Make it engaging and informative, suitable for a Telegram channel

**Format Guidelines:**
- Use <b> for event titles and important information
- Use <i> for dates, times, and locations
- Use <a> tags only for links (not for @ mentions - those should be plain text)
- Keep paragraphs short and readable
- Highlight: event title, date/time, location, key details

Generate the message now:`;

  const { text } = await generateText({
    model: google("gemini-2.5-flash"),
    prompt,
    maxTokens: 500,
  });

  // Ensure the message ends with Instagram link
  let message = text.trim();
  const instagramLink = `\n\n<a href="${postUrl}">View on Instagram</a>`;
  
  // Remove any existing Instagram link if present
  message = message.replace(/\n\n<a href="[^"]+">View on Instagram<\/a>\s*$/, "");
  
  // Add the Instagram link
  message = message + instagramLink;

  // Truncate if too long, preserving sentence boundaries
  if (message.length > MAX_TELEGRAM_MESSAGE_LENGTH) {
    const availableLength = MAX_TELEGRAM_MESSAGE_LENGTH - instagramLink.length;
    // Try to truncate at sentence boundary
    const truncated = message.substring(0, availableLength);
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf("."),
      truncated.lastIndexOf("!"),
      truncated.lastIndexOf("?")
    );
    
    if (lastSentenceEnd > availableLength * 0.7) {
      // Use sentence boundary if it's not too early
      message = message.substring(0, lastSentenceEnd + 1) + "..." + instagramLink;
    } else {
      // Otherwise truncate at word boundary
      const lastSpace = truncated.lastIndexOf(" ");
      if (lastSpace > availableLength * 0.7) {
        message = message.substring(0, lastSpace) + "..." + instagramLink;
      } else {
        message = message.substring(0, availableLength) + "..." + instagramLink;
      }
    }
  }

  return message;
}

// Action wrapper for workflow calls
export const generateTelegramMessage = action({
  args: {
    metadataId: v.id("post_metadata"),
    postUrl: v.string(),
  },
  handler: async (ctx, { metadataId, postUrl }) => {
    const metadata = await ctx.runQuery(async (ctx) => {
      const meta = await ctx.db.get(metadataId);
      if (!meta) {
        throw new Error(`Metadata with id ${metadataId} not found`);
      }
      return meta;
    });

    return await generateTelegramMessageInternal(metadata, postUrl);
  },
});
