/**
 * Centralized media validators
 *
 * This module defines all media-related validators in one place to eliminate
 * duplication across the codebase. There are three distinct contexts:
 *
 * 1. Instagram (fetched) - URL required, no file_id (source data)
 * 2. Telegram (sending) - either URL or file_id, prefers file_id
 * 3. Telegram (storage) - file_id required (persisted after send)
 */

import type { Infer } from "convex/values";
import { v } from "convex/values";

/**
 * Media item type validator - shared across all media item contexts
 * (image, video, thumbnail for individual media files)
 */
export const mediaTypeValidator = v.union(
	v.literal("image"),
	v.literal("video"),
	v.literal("thumbnail"),
);

/**
 * Post media type validator - for Instagram post classification
 * (image, video, carousel for the overall post type)
 */
export const postMediaTypeValidator = v.union(
	v.literal("image"),
	v.literal("video"),
	v.literal("carousel"),
);

/**
 * Instagram fetched media - URL required, no file_id
 * Used when fetching posts from Instagram API
 */
export const instagramMediaItemValidator = v.object({
	url: v.string(),
	type: mediaTypeValidator,
	width: v.optional(v.number()),
	height: v.optional(v.number()),
});

/**
 * Telegram media for sending - requires either url or file_id
 * Used when building Telegram API requests
 */
export const telegramMediaItemValidator = v.union(
	// URL-based media (from Instagram, no file_id yet)
	v.object({
		url: v.string(),
		file_id: v.optional(v.string()),
		file_unique_id: v.optional(v.string()),
		type: mediaTypeValidator,
		width: v.optional(v.number()),
		height: v.optional(v.number()),
	}),
	// File ID-based media (cached in Telegram)
	v.object({
		url: v.optional(v.string()),
		file_id: v.string(),
		file_unique_id: v.string(),
		type: mediaTypeValidator,
		width: v.optional(v.number()),
		height: v.optional(v.number()),
	}),
);

/**
 * Telegram file_id for storage - file_id required
 * Used when syncing media items with Telegram file_ids
 */
export const telegramFileIdItemValidator = v.object({
	file_id: v.string(),
	file_unique_id: v.string(),
	type: v.union(v.literal("image"), v.literal("video"), v.literal("thumbnail")),
	width: v.optional(v.number()),
	height: v.optional(v.number()),
});

/**
 * File ID info returned from Telegram after sending
 */
export const fileIdInfoValidator = v.object({
	file_id: v.string(),
	file_unique_id: v.string(),
	type: v.union(v.literal("image"), v.literal("video")),
});

// Inferred types for use in TypeScript
export type MediaType = Infer<typeof mediaTypeValidator>;
export type PostMediaType = Infer<typeof postMediaTypeValidator>;
export type InstagramMediaItem = Infer<typeof instagramMediaItemValidator>;
export type TelegramMediaItem = Infer<typeof telegramMediaItemValidator>;
export type TelegramFileIdItem = Infer<typeof telegramFileIdItemValidator>;
export type FileIdInfo = Infer<typeof fileIdInfoValidator>;
