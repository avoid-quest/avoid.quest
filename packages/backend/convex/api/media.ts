/**
 * Public API for media items - used by instarip web frontend
 */
import { v } from "convex/values";
import { components } from "../_generated/api";
import { query } from "../_generated/server";

/**
 * Get media items for a post
 */
export const getByPostId = query({
	args: { postId: v.string() },
	handler: async (ctx, { postId }) => {
		return await ctx.runQuery(
			components.instarip.mediaItems.getMediaItemsByPostId,
			{ postId },
		);
	},
});
