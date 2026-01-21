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
 *
 * Uses fmt function form to properly compose FormattedString objects:
 * fmt(templateStrings, ...values) where templateStrings are the text
 * between mentions and values are the instagramMention() links.
 */
export function linkInstagramMentions(text: string) {
  // Build template strings array (text between mentions) and values (mention links)
  const strings: string[] = [];
  const values: ReturnType<typeof link>[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(MENTION_REGEX)) {
    if (match.index === undefined) {
      continue;
    }

    // Add text before the mention as a template string part
    strings.push(text.substring(lastIndex, match.index));

    // Add the mention as a link value
    const username = match[1];
    if (username) {
      values.push(instagramMention(username));
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text as final template string part
  strings.push(text.substring(lastIndex));

  // If no mentions found, return plain text wrapped in fmt
  if (values.length === 0) {
    return fmt`${text}`;
  }

  // Use fmt function form: fmt(templateStrings, ...values)
  // This properly composes FormattedString objects instead of joining them
  return fmt(strings as unknown as TemplateStringsArray, ...values);
}

/**
 * Create a "View on Instagram" footer link
 */
export function instagramFooter(postUrl: string) {
  return fmt`

${link("View on Instagram", postUrl)}`;
}
