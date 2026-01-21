/**
 * Re-export @grammyjs/parse-mode utilities for type-safe message formatting
 * These provide template tag functions that auto-escape user content
 */
export {
  bold,
  code,
  type FormattedString,
  fmt,
  italic,
  link,
  pre,
  spoiler,
  strikethrough,
  underline,
} from "@grammyjs/parse-mode";

import { fmt, link } from "@grammyjs/parse-mode";

const AT_PREFIX_REGEX = /^@/;
const MENTION_REGEX = /@([a-zA-Z0-9._]+)/g;

/**
 * Create a mention link for an Instagram user
 */
export function instagramMention(username: string) {
  const cleanUsername = username.replace(AT_PREFIX_REGEX, "");
  return link(`@${cleanUsername}`, `https://instagram.com/${cleanUsername}`);
}

/**
 * Convert Instagram @ mentions in text to clickable links
 * Returns a FormattedString that can be used with ctx.replyFmt
 */
export function linkInstagramMentions(text: string) {
  const parts: Array<string | ReturnType<typeof link>> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(MENTION_REGEX)) {
    if (match.index === undefined) {
      continue;
    }

    // Add text before the mention
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    // Add the mention as a link
    const username = match[1];
    if (username) {
      parts.push(instagramMention(username));
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  // Use fmt to combine all parts with proper escaping
  return fmt`${parts.map((p) => (typeof p === "string" ? p : p)).join("")}`;
}

/**
 * Create a "View on Instagram" footer link
 */
export function instagramFooter(postUrl: string) {
  return fmt`

${link("View on Instagram", postUrl)}`;
}
