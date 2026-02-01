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

			// Update event_date:
			// - If date was extracted from caption, use it
			// - If no date found, use post timestamp as fallback (for consistent sorting)
			if (!dryRun) {
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

/**
 * Reprocess ALL posts to fix incorrect event_dates
 * Use this when existing event_date values are wrong and need recalculation
 *
 * @param limit - Maximum number of posts to process per run
 * @param dryRun - If true, only report what would be changed
 * @param cursor - Pagination cursor for processing large datasets
 */
export const reprocessAllEventDates = action({
	args: {
		limit: v.optional(v.number()),
		dryRun: v.optional(v.boolean()),
		cursor: v.optional(v.union(v.string(), v.null())),
	},
	handler: async (ctx, { limit = 50, dryRun = false, cursor }) => {
		// Get all posts with pagination
		const result = await ctx.runQuery(
			components.instarip.posts.getPostsPaginated,
			{ cursor: cursor ?? null, numItems: limit },
		);

		if (result.page.length === 0) {
			return {
				processed: 0,
				updated: 0,
				changed: 0,
				isDone: true,
				continueCursor: null,
				message: "No posts to process",
			};
		}

		let updated = 0;
		let changed = 0;
		const changes: Array<{
			id: string;
			shortcode: string;
			oldDate: number | undefined;
			newDate: number;
			oldDateStr: string;
			newDateStr: string;
			diff: string;
		}> = [];

		// Import date extractor dynamically
		const { getEventTimestamp } = await import("../lib/dateExtractor");

		for (const post of result.page) {
			// Extract event date from caption using post timestamp as reference
			const newEventDate = getEventTimestamp(post.caption, post.timestamp);
			const oldEventDate = post.event_date;

			// Check if the date changed
			const dateChanged = oldEventDate !== newEventDate;

			if (dateChanged) {
				changed++;
				const oldDateStr = oldEventDate
					? new Date(oldEventDate).toISOString().split("T")[0]
					: "undefined";
				const newDateStr = new Date(newEventDate).toISOString().split("T")[0];

				// Calculate difference in days
				const diffMs = oldEventDate
					? newEventDate - oldEventDate
					: 0;
				const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

				changes.push({
					id: post._id,
					shortcode: post.shortcode,
					oldDate: oldEventDate,
					newDate: newEventDate,
					oldDateStr,
					newDateStr,
					diff: diffDays !== 0 ? `${diffDays} days` : "new",
				});

				if (!dryRun) {
					await ctx.runMutation(components.instarip.posts.updateEventDate, {
						id: post._id,
						event_date: newEventDate,
					});
					updated++;
				}
			}
		}

		return {
			processed: result.page.length,
			updated,
			changed,
			dryRun,
			isDone: result.isDone,
			continueCursor: result.continueCursor,
			// Only return detailed changes on dry run to avoid JSON issues
			changes: dryRun ? changes.slice(0, 20) : [],
		};
	},
});
