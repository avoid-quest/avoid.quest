/**
 * Caption formatting utilities for Telegram messages
 * Uses HTML parse mode for Instagram-style formatting
 */

import { TELEGRAM_DEFAULTS } from "./defaults";

/** Maximum caption length for Telegram media */
export const MAX_CAPTION_LENGTH = TELEGRAM_DEFAULTS.MAX_CAPTION_LENGTH;

/** Maximum message length for Telegram text messages */
export const MAX_MESSAGE_LENGTH = TELEGRAM_DEFAULTS.MAX_MESSAGE_LENGTH;

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
	return `<a href="${url}">${escapeHtml(text)}</a>`;
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
	return text.replace(/@([a-zA-Z0-9_.]+)/g, (_match, username) => {
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
 *
 * IMPORTANT: Truncation must happen BEFORE adding HTML links,
 * otherwise we risk cutting through <a> tags which Telegram rejects.
 */
export function buildCaption(options: {
	caption: string;
	postUrl: string;
	maxLength?: number;
}): string {
	const { caption, postUrl, maxLength = MAX_CAPTION_LENGTH } = options;

	const footer = instagramFooter(postUrl);
	const escapedCaption = escapeHtml(caption);

	// First check: if full caption with mentions fits, return it
	const withMentions = linkInstagramMentions(escapedCaption);
	if (withMentions.length + footer.length <= maxLength) {
		return withMentions + footer;
	}

	// Need truncation - MUST truncate BEFORE adding HTML links
	// to avoid cutting through <a> tags

	// Count mentions to estimate expansion buffer
	const mentionPattern = /@[a-zA-Z0-9_.]+/g;
	const mentions = escapedCaption.match(mentionPattern) || [];
	// Each mention adds ~43 chars for HTML wrapper
	// Use conservative estimate: assume half survive truncation
	const expansionBuffer = Math.ceil(mentions.length / 2) * 43;

	// Truncate escaped text (no HTML tags yet, safe to cut)
	const availableForContent = maxLength - footer.length - expansionBuffer - 3;
	const truncatedEscaped = truncateAtWordBoundary(
		escapedCaption,
		Math.max(availableForContent, 100),
	);

	// Now add mentions to the already-truncated text
	const truncatedWithMentions = linkInstagramMentions(truncatedEscaped);

	// Final safety check - if still over, truncate more without mentions
	if (truncatedWithMentions.length + footer.length > maxLength) {
		const safeLength = maxLength - footer.length - 3;
		const safeTruncated = truncateAtWordBoundary(escapedCaption, safeLength);
		return safeTruncated + footer;
	}

	return truncatedWithMentions + footer;
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
