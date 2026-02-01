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
 * Reprocess ALL posts with multi-date extraction
 * Extracts all event dates from captions and updates posts
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
				multiDatePosts: 0,
				isDone: true,
				continueCursor: null,
				message: "No posts to process",
			};
		}

		let updated = 0;
		let changed = 0;
		let multiDatePosts = 0;
		const changes: Array<{
			id: string;
			shortcode: string;
			dateCount: number;
			dates: string[];
		}> = [];

		// Import date extractor dynamically
		const { extractAllEventDates } = await import("../lib/dateExtractor");

		for (const post of result.page) {
			// Extract ALL event dates from caption
			const extraction = extractAllEventDates(post.caption, post.timestamp);
			const oldEventDate = post.event_date;

			// Check if anything changed
			const primaryChanged = oldEventDate !== extraction.primaryDate;
			const hasMultipleDates = extraction.dates.length > 1;

			if (hasMultipleDates) {
				multiDatePosts++;
			}

			if (primaryChanged || hasMultipleDates) {
				changed++;

				changes.push({
					id: post._id,
					shortcode: post.shortcode,
					dateCount: extraction.dates.length,
					dates: extraction.dates.map(
						(ts) => new Date(ts).toISOString().split("T")[0],
					),
				});

				if (!dryRun) {
					await ctx.runMutation(components.instarip.posts.updateEventDates, {
						id: post._id,
						event_date: extraction.primaryDate,
						event_dates: extraction.dates,
						event_period: extraction.period ?? undefined,
					});
					updated++;
				}
			}
		}

		return {
			processed: result.page.length,
			updated,
			changed,
			multiDatePosts,
			dryRun,
			isDone: result.isDone,
			continueCursor: result.continueCursor,
			// Only return detailed changes on dry run to avoid JSON issues
			changes: dryRun ? changes.slice(0, 20) : [],
		};
	},
});
