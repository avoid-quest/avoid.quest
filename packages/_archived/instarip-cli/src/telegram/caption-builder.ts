import {
  escapeHtml,
  MAX_CAPTION_LENGTH,
  truncateText,
} from "@avoid.quest/telegram";
import type { Doc } from "@workspace/backend/convex/_generated/dataModel";

const MENTION_REGEX = /@([a-zA-Z0-9._]+)/g;
const WHITESPACE_CLEANUP_REGEX = /\s{3,}/g;
const NEWLINE_CLEANUP_REGEX = /\n\s*\n\s*\n/g;

/**
 * Escape HTML entities in text to make it safe for Telegram HTML parsing
 * Re-exported for backwards compatibility
 */
export { escapeHtml as escapeHtmlEntities } from "@avoid.quest/telegram";

/**
 * Convert Instagram @ mentions to clickable Instagram profile links
 * Simple text-based approach without DOM parsing
 */
export function linkMentions(text: string): string {
  if (!text || text.trim().length === 0) {
    return text;
  }

  return text.replace(MENTION_REGEX, (_match, username: string) => {
    return `<a href="https://instagram.com/${username}">@${username}</a>`;
  });
}

/**
 * Truncate text content accounting for HTML overhead from mentions
 */
function truncateForCaption(text: string, maxLength: number): string {
  if (!text || text.trim().length === 0) {
    return text;
  }

  // Account for HTML markup overhead from mentions
  // Each @ mention becomes ~50 chars of HTML
  const HTML_OVERHEAD_PER_MENTION = 50;
  const EXTRA_BUFFER = 50;
  const mentionCount = (text.match(/@/g) || []).length;
  const estimatedHtmlOverhead =
    mentionCount * HTML_OVERHEAD_PER_MENTION + EXTRA_BUFFER;
  const safeMaxLength = Math.max(0, maxLength - estimatedHtmlOverhead);

  if (safeMaxLength <= 0) {
    return "";
  }

  const truncated = truncateText(text, safeMaxLength);

  // Escape and add links
  const escaped = escapeHtml(truncated);
  return linkMentions(escaped);
}

/**
 * Create caption with proper formatting and truncation
 * Uses AI-generated telegram_message from metadata if available, otherwise falls back to raw caption
 */
export function createCaption(
  post: Doc<"posts">,
  metadata?: Doc<"post_metadata"> | null
): string {
  // Check if AI-generated telegram message exists and is non-empty
  if (
    metadata?.telegram_message &&
    metadata.telegram_message.trim().length > 0
  ) {
    // AI-generated message is already HTML-formatted and sanitized
    // It should already include the Instagram link
    return metadata.telegram_message;
  }

  // Fallback to raw caption formatting
  let rawCaption = "";

  if (post.caption) {
    // Preserve original formatting but clean up excessive whitespace
    rawCaption = post.caption
      .replace(WHITESPACE_CLEANUP_REGEX, " ")
      .replace(NEWLINE_CLEANUP_REGEX, "\n\n")
      .trim();
  }

  // Build Instagram link footer
  const instagramLink = post.url
    ? `\n\n<a href="${post.url}">View on Instagram</a>`
    : "";

  // If no caption, just return the link
  if (!rawCaption) {
    return instagramLink.trim();
  }

  // Calculate available space for caption (reserve space for Instagram link)
  const availableLength = MAX_CAPTION_LENGTH - instagramLink.length;

  // Truncate and format the caption
  const formattedCaption = truncateForCaption(rawCaption, availableLength);

  return formattedCaption + instagramLink;
}
