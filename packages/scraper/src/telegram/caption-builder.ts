import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import { MAX_CAPTION_LENGTH } from "./types";

/**
 * Escape HTML entities in text to make it safe for Telegram HTML parsing
 */
export function escapeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert Instagram @ mentions to clickable Instagram profile links
 * Only converts mentions that are NOT already inside HTML tags
 */
export function linkMentions(html: string): string {
  return html.replace(/@([a-zA-Z0-9._]+)/g, (match, username: string) => {
    // Check if this @ mention is already inside an <a> tag
    const beforeMatch = html.substring(0, html.indexOf(match));
    const lastOpenTag = beforeMatch.lastIndexOf("<a ");
    const lastCloseTag = beforeMatch.lastIndexOf("</a>");

    // If we're inside an <a> tag, don't convert
    if (lastOpenTag > lastCloseTag) {
      return match;
    }

    return `<a href="https://instagram.com/${username}">@${username}</a>`;
  });
}

/**
 * Sanitize HTML to prevent parsing errors in Telegram
 * Simplified version without DOMPurify dependency
 */
export function sanitizeHtmlForTelegram(html: string): string {
  // Remove any unclosed or malformed HTML tags
  let sanitized = html;

  // Fix common issues:
  // 1. Remove unclosed tags at end of string
  sanitized = sanitized.replace(/<a[^>]*$/g, "");

  // 2. Remove orphaned closing tags
  sanitized = sanitized.replace(/<\/a>(?![^<]*<a[^>]*>)/g, "");

  // 3. Ensure all <a> tags are properly closed
  const openTags = (sanitized.match(/<a[^>]*>/g) || []).length;
  const closeTags = (sanitized.match(/<\/a>/g) || []).length;

  if (openTags > closeTags) {
    // Remove excess opening tags
    let excess = openTags - closeTags;
    sanitized = sanitized.replace(/<a[^>]*>/g, (match) => {
      if (excess > 0) {
        excess--;
        return "";
      }
      return match;
    });
  }

  // 4. Basic validation - check for balanced tags
  // If we have mismatched tags, convert to plain text as fallback
  const remainingOpenTags = (sanitized.match(/<a[^>]*>/g) || []).length;
  const remainingCloseTags = (sanitized.match(/<\/a>/g) || []).length;

  if (remainingOpenTags !== remainingCloseTags) {
    // If tags are still unbalanced, strip all HTML
    return sanitized.replace(/<[^>]*>/g, "").trim();
  }

  return sanitized;
}

/**
 * Truncate HTML content by counting actual text content, not HTML markup
 */
function truncateHtmlContent(html: string, maxLength: number): string {
  // Extract plain text to check length
  const textContent = html.replace(/<[^>]*>/g, "");

  // Always truncate to be safe, accounting for HTML markup overhead
  // Each @ mention becomes ~50 chars of HTML
  const estimatedHtmlOverhead = (textContent.match(/@/g) || []).length * 50;
  const safeMaxLength = maxLength - estimatedHtmlOverhead - 50; // Extra buffer

  if (safeMaxLength <= 0) {
    // If we don't have enough space, return empty string
    return "";
  }

  // Truncate plain text first
  const truncatedText = textContent.substring(0, safeMaxLength) + "...";

  // Escape HTML entities FIRST
  const escapedText = escapeHtmlEntities(truncatedText);

  // Convert @ mentions to HTML links AFTER escaping
  const htmlWithLinks = linkMentions(escapedText);

  // Sanitize the final HTML
  return sanitizeHtmlForTelegram(htmlWithLinks);
}

/**
 * Create caption with proper formatting and truncation
 */
export function createCaption(post: Doc<"posts">): string {
  let caption = "";

  if (post.caption) {
    // Preserve original formatting but clean up excessive whitespace
    caption = post.caption
      .replace(/\s{3,}/g, " ") // Replace 3+ spaces with single space
      .replace(/\n\s*\n\s*\n/g, "\n\n") // Replace 3+ newlines with double newline
      .trim();

    // Escape HTML entities FIRST to make it safe for Telegram
    caption = escapeHtmlEntities(caption);

    // Convert Instagram @ mentions to clickable links AFTER escaping
    caption = linkMentions(caption);
  }

  // Add Instagram link as footer
  const instagramLink = post.url
    ? `\n\n<a href="${post.url}">View on Instagram</a>`
    : "";

  let combined = caption + instagramLink;

  // Telegram caption limit is 1024 characters
  if (combined.length > MAX_CAPTION_LENGTH) {
    // Extract Instagram link for preservation
    const instagramLinkMatch = combined.match(
      /\n\n<a href="([^"]+)">View on Instagram<\/a>/
    );
    const instagramLinkHtml = instagramLinkMatch ? instagramLinkMatch[0] : "";

    // Get caption without Instagram link
    const captionWithoutLink = instagramLinkHtml
      ? combined.replace(instagramLinkHtml, "").trim()
      : combined;

    // Calculate available space for content (reserve space for Instagram link)
    const linkLength = instagramLinkHtml.length;
    const availableLength = MAX_CAPTION_LENGTH - linkLength;

    // Truncate HTML content by counting actual text content, not HTML markup
    const truncatedHtml = truncateHtmlContent(
      captionWithoutLink,
      availableLength
    );

    // Add back Instagram link
    combined = truncatedHtml + instagramLinkHtml;
  }

  return combined;
}

