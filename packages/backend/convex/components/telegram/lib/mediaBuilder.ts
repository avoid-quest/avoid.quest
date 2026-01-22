/**
 * Media group building utilities for Telegram
 * Handles both URL-based and file_id-based media
 */

import type { TelegramMediaItem } from "../../../lib/validators";
import type { InputMedia, InputMediaPhoto, InputMediaVideo } from "./apiClient";

/** Maximum items in a Telegram media group */
export const MAX_MEDIA_GROUP_SIZE = 10;

/** Minimum items for a media group (otherwise send individually) */
export const MIN_MEDIA_GROUP_SIZE = 2;

/**
 * Media item from database (may have URL or file_id)
 * Alias for TelegramMediaItem for backwards compatibility
 */
export type MediaItemInput = TelegramMediaItem;

/**
 * Filter and validate media items for sending
 * - Removes thumbnails
 * - Limits to MAX_MEDIA_GROUP_SIZE
 * - Prefers file_id over URL
 */
export function filterMediaItems(items: MediaItemInput[]): MediaItemInput[] {
	return items
		.filter((item) => item.type !== "thumbnail")
		.filter((item) => item.file_id || item.url)
		.slice(0, MAX_MEDIA_GROUP_SIZE);
}

/**
 * Build InputMedia object for a single item
 */
function buildInputMediaItem(
	item: MediaItemInput,
	caption?: string,
): InputMedia | null {
	// Prefer file_id (permanent) over URL (may expire)
	const media = item.file_id ?? item.url;
	if (!media) return null;

	if (item.type === "image") {
		const photo: InputMediaPhoto = {
			type: "photo",
			media,
			...(caption && { caption, parse_mode: "HTML" as const }),
		};
		return photo;
	}

	if (item.type === "video") {
		const video: InputMediaVideo = {
			type: "video",
			media,
			...(caption && { caption, parse_mode: "HTML" as const }),
			...(item.width && { width: item.width }),
			...(item.height && { height: item.height }),
			supports_streaming: true,
		};
		return video;
	}

	return null;
}

/**
 * Build a media group for Telegram API
 * Caption goes on first item only
 */
export function buildMediaGroup(
	items: MediaItemInput[],
	caption: string,
): InputMedia[] {
	const filtered = filterMediaItems(items);
	const mediaGroup: InputMedia[] = [];

	for (let i = 0; i < filtered.length; i++) {
		const item = filtered[i];
		// Caption only on first item
		const itemCaption = i === 0 ? caption : undefined;
		const inputMedia = buildInputMediaItem(item, itemCaption);

		if (inputMedia) {
			mediaGroup.push(inputMedia);
		}
	}

	return mediaGroup;
}

/**
 * Get the primary media item (first non-thumbnail)
 * Used for single-item posts
 */
export function getPrimaryMedia(
	items: MediaItemInput[],
): MediaItemInput | null {
	const filtered = filterMediaItems(items);
	return filtered[0] ?? null;
}

/**
 * Determine send strategy based on media count
 */
export type SendStrategy =
	| { type: "text"; reason: "no_media" }
	| { type: "single"; item: MediaItemInput }
	| { type: "group"; items: MediaItemInput[] };

export function determineSendStrategy(items: MediaItemInput[]): SendStrategy {
	const filtered = filterMediaItems(items);

	if (filtered.length === 0) {
		return { type: "text", reason: "no_media" };
	}

	if (filtered.length === 1) {
		return { type: "single", item: filtered[0] };
	}

	return { type: "group", items: filtered };
}
