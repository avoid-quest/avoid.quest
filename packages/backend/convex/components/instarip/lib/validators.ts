/**
 * Shared validators for the instarip component
 *
 * These validators are isolated within the component to maintain independence
 * from the main app's validator definitions.
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
 * Instagram fetched media - URL required, no file_id
 * Used when fetching posts from Instagram API
 */
export const instagramMediaItemValidator = v.object({
	url: v.string(),
	type: mediaTypeValidator,
	width: v.optional(v.number()),
	height: v.optional(v.number()),
});

// Inferred types for use in TypeScript
export type MediaType = Infer<typeof mediaTypeValidator>;
export type InstagramMediaItem = Infer<typeof instagramMediaItemValidator>;
