/**
 * Caption formatting utilities for Telegram messages
 * Uses HTML parse mode for Instagram-style formatting
 */

/** Maximum caption length for Telegram media */
export const MAX_CAPTION_LENGTH = 1024;

/** Maximum message length for Telegram text messages */
export const MAX_MESSAGE_LENGTH = 4096;

/**
 * Escape HTML special characters for Telegram HTML parse mode
 */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Create a bold text element
 */
export function bold(text: string): string {
	return `<b>${escapeHtml(text)}</b>`;
}

/**
 * Create an italic text element
 */
export function italic(text: string): string {
	return `<i>${escapeHtml(text)}</i>`;
}

/**
 * Create a hyperlink
 */
export function link(text: string, url: string): string {
	return `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
}

/**
 * Create an Instagram profile link
 */
export function instagramMention(username: string): string {
	const cleanUsername = username.replace(/^@/, "");
	return link(`@${cleanUsername}`, `https://instagram.com/${cleanUsername}`);
}

/**
 * Convert @mentions in text to clickable Instagram links
 */
export function linkInstagramMentions(text: string): string {
	return text.replace(/@([a-zA-Z0-9_.]+)/g, (match, username) => {
		return instagramMention(username);
	});
}

/**
 * Create Instagram post footer link
 */
export function instagramFooter(postUrl: string): string {
	return `\n\n${link("View on Instagram", postUrl)}`;
}

/**
 * Truncate text at word boundary
 */
export function truncateAtWordBoundary(
	text: string,
	maxLength: number,
): string {
	if (text.length <= maxLength) return text;

	const truncated = text.slice(0, maxLength);
	const lastSpace = truncated.lastIndexOf(" ");

	if (lastSpace > maxLength * 0.7) {
		return `${truncated.slice(0, lastSpace)}...`;
	}

	return `${truncated.slice(0, maxLength - 3)}...`;
}

/**
 * Truncate content while preserving a footer
 */
export function truncateWithFooter(
	content: string,
	footer: string,
	maxLength: number,
): string {
	const totalLength = content.length + footer.length;

	if (totalLength <= maxLength) {
		return content + footer;
	}

	const availableForContent = maxLength - footer.length - 3; // -3 for "..."
	const truncatedContent = truncateAtWordBoundary(content, availableForContent);

	return truncatedContent + footer;
}

/**
 * Build a complete caption for a post
 * Handles Instagram mentions and truncation
 */
export function buildCaption(options: {
	caption: string;
	postUrl: string;
	maxLength?: number;
}): string {
	const { caption, postUrl, maxLength = MAX_CAPTION_LENGTH } = options;

	// Escape HTML but preserve our formatting
	const escapedCaption = escapeHtml(caption);

	// Convert @mentions to Instagram links
	const withMentions = linkInstagramMentions(escapedCaption);

	// Add footer
	const footer = instagramFooter(postUrl);

	// Truncate if needed while preserving footer
	return truncateWithFooter(withMentions, footer, maxLength);
}

/**
 * Build a simple message (no media)
 */
export function buildMessage(options: {
	text: string;
	maxLength?: number;
}): string {
	const { text, maxLength = MAX_MESSAGE_LENGTH } = options;
	return truncateAtWordBoundary(escapeHtml(text), maxLength);
}
