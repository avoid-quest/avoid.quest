/**
 * Telegram caption length limit
 */
export const MAX_CAPTION_LENGTH = 1024;

/**
 * Telegram message length limit
 */
export const MAX_MESSAGE_LENGTH = 4096;

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const ellipsis = "...";
  return text.substring(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Truncate text while preserving a footer (e.g., Instagram link)
 * The footer is always preserved at the end
 */
export function truncateWithFooter(
  content: string,
  footer: string,
  maxLength: number
): string {
  const combined = content + footer;

  if (combined.length <= maxLength) {
    return combined;
  }

  const ellipsis = "...";
  const availableForContent = maxLength - footer.length - ellipsis.length;

  if (availableForContent <= 0) {
    // Footer alone exceeds max length, truncate it
    return truncateText(footer, maxLength);
  }

  return content.substring(0, availableForContent) + ellipsis + footer;
}

/**
 * Smart truncation that tries to break at word boundaries
 */
export function truncateAtWordBoundary(
  text: string,
  maxLength: number
): string {
  if (text.length <= maxLength) {
    return text;
  }

  const ellipsis = "...";
  const truncateAt = maxLength - ellipsis.length;

  // Find last space before truncation point
  const lastSpace = text.lastIndexOf(" ", truncateAt);

  if (lastSpace > truncateAt * 0.5) {
    // Only use word boundary if it doesn't cut too much
    return text.substring(0, lastSpace) + ellipsis;
  }

  return text.substring(0, truncateAt) + ellipsis;
}
