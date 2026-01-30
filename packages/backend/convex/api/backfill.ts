/**
 * Backfill operations for event dates
 * Separated from admin.ts to avoid bundling issues with chrono-node
 */
import { v } from "convex/values";
import { components } from "../_generated/api";
import { action, query } from "../_generated/server";

/**
 * Backfill event dates for existing posts
 * Extracts dates from captions and updates posts
 *
 * @param limit - Maximum number of posts to process per run
 * @param dryRun - If true, only report what would be changed
 */
export const backfillEventDates = action({
	args: {
		limit: v.optional(v.number()),
		dryRun: v.optional(v.boolean()),
	},
	handler: async (ctx, { limit = 50, dryRun = false }) => {
		// Get posts that need backfill
		const posts = await ctx.runQuery(
			components.instarip.posts.getPostsNeedingDateBackfill,
			{ limit },
		);

		if (posts.length === 0) {
			return { processed: 0, updated: 0, message: "No posts need backfill" };
		}

		let updated = 0;
		const results: Array<{
			id: string;
			caption: string;
			oldDate: number | undefined;
			newDate: number;
			extracted: boolean;
		}> = [];

		// Import date extractor dynamically (chrono-node has Convex bundling issues)
		const { getEventTimestamp } = await import("../lib/dateExtractor");

		for (const post of posts) {
			// Extract event date from caption
			const eventDate = getEventTimestamp(post.caption, post.timestamp);
			const extracted = eventDate !== post.timestamp;

			results.push({
				id: post._id,
				caption:
					post.caption.length > 100
						? `${post.caption.slice(0, 100)}...`
						: post.caption,
				oldDate: post.event_date,
				newDate: eventDate,
				extracted,
			});

			// Only update if we found a real date (not fallback)
			// and not in dry run mode
			if (extracted && !dryRun) {
				await ctx.runMutation(components.instarip.posts.updateEventDate, {
					id: post._id,
					event_date: eventDate,
				});
				updated++;
			}
		}

		return {
			processed: posts.length,
			updated,
			dryRun,
			results,
		};
	},
});

/**
 * Get event date backfill statistics
 */
export const getEventDateStats = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.runQuery(
			components.instarip.posts.getEventDateBackfillStats,
			{},
		);
	},
});
