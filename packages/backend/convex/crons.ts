import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const crons = cronJobs();

// Telegram sending cron - runs every 30 minutes
crons.interval(
	"send telegram posts",
	{ minutes: 30 },
	internal.crons.runTelegramSend,
);

// Instagram fetch cron - runs every hour
crons.interval(
	"fetch instagram posts",
	{ hours: 1 },
	internal.crons.runInstagramFetch,
);

export default crons;

/**
 * Orchestration layer for Telegram sending
 * Fetches unsent posts and sends them via the Telegram component
 */
export const runTelegramSend = internalAction({
	args: {},
	returns: v.object({
		skipped: v.optional(v.boolean()),
		sent: v.optional(v.number()),
		failed: v.optional(v.number()),
		errors: v.optional(v.array(v.string())),
	}),
	handler: async (ctx) => {
		// Get settings
		const settings = await ctx.runQuery(internal.settings.getSettingsInternal);
		if (!settings?.telegram?.active) {
			return { skipped: true };
		}

		const chatId = settings.telegram.group_chat_id;
		if (!chatId) {
			return { skipped: true, errors: ["No group_chat_id configured"] };
		}

		const limit = settings.telegram.send_limit ?? 3;

		// Get unsent posts
		const posts = await ctx.runQuery(internal.posts.getUnsentInternal, {
			limit,
		});

		if (posts.length === 0) {
			return { sent: 0, failed: 0 };
		}

		let sent = 0;
		let failed = 0;
		const errors: string[] = [];

		for (const post of posts) {
			// Get media items for this post
			const mediaItems = await ctx.runQuery(
				internal.media_items.getMediaItemsByPostIdInternal,
				{ postId: post._id },
			);

			// Send via Telegram component
			const result = await ctx.runAction(
				components.telegram.sender.sendMessage,
				{
					chatId,
					caption: post.caption,
					mediaItems: mediaItems.map((item) => ({
						url: item.url,
						file_id: item.file_id,
						type: item.type,
						width: item.width,
						height: item.height,
					})),
					postUrl: post.url,
				},
			);

			if (result.success) {
				// Mark post as sent
				await ctx.runMutation(internal.posts.markSentInternal, {
					id: post._id,
					sentAt: Date.now(),
				});
				sent++;
			} else {
				failed++;
				errors.push(`Post ${post.shortcode}: ${result.error}`);
			}

			// Small delay between posts to avoid rate limiting
			await new Promise((resolve) => setTimeout(resolve, 500));
		}

		return { sent, failed, errors: errors.length > 0 ? errors : undefined };
	},
});

/** Minimum interval between scrapes for the same user (30 minutes) */
const MIN_SCRAPE_INTERVAL_MS = 30 * 60 * 1000;

/** Convert seconds to milliseconds for timestamp storage */
function secondsToMilliseconds(seconds: number): number {
	return seconds * 1000;
}

/**
 * Orchestration layer for Instagram fetching
 * Fetches posts for users marked as to_be_scraped via the Instagram component
 */
export const runInstagramFetch = internalAction({
	args: {},
	returns: v.object({
		skipped: v.optional(v.boolean()),
		usersProcessed: v.optional(v.number()),
		newPosts: v.optional(v.number()),
		errors: v.optional(v.array(v.string())),
	}),
	handler: async (ctx) => {
		// Get settings
		const settings = await ctx.runQuery(internal.settings.getSettingsInternal);
		if (!settings?.instagram?.active) {
			return { skipped: true };
		}

		const userLimit = settings.instagram.limit ?? 5;
		const postsPerUser = settings.instagram.post_per_user ?? 20;

		// Get users to scrape (respecting minimum interval)
		const users = await ctx.runQuery(internal.users.listToBeScrapedInternal, {
			limit: userLimit,
			minIntervalMs: MIN_SCRAPE_INTERVAL_MS,
		});

		if (users.length === 0) {
			return { usersProcessed: 0, newPosts: 0 };
		}

		let usersProcessed = 0;
		let newPosts = 0;
		const errors: string[] = [];

		for (const user of users) {
			try {
				// Fetch posts via Instagram component
				const result = await ctx.runAction(
					components.instagram.fetcher.fetchUser,
					{
						username: user.username,
						limit: postsPerUser,
					},
				);

				if (!result.success) {
					errors.push(`User ${user.username}: ${result.error}`);
					continue;
				}

				// Process each fetched post
				for (const post of result.posts) {
					// Check if post already exists
					const existing = await ctx.runQuery(
						internal.posts.getPostByShortcodeInternal,
						{ shortcode: post.shortcode },
					);

					if (existing) {
						// Post already exists, skip
						continue;
					}

					// Convert timestamp from seconds to milliseconds
					const timestampMs = secondsToMilliseconds(post.timestampSec);

					// Upsert the post
					const postId = await ctx.runMutation(
						internal.posts.upsertPostInternal,
						{
							ig_id: post.id,
							shortcode: post.shortcode,
							display_url: post.display_url,
							video_url: post.video_url,
							thumbnail_url: post.thumbnail_url,
							caption: post.caption,
							is_video: post.is_video,
							url: post.url,
							media_type: post.media_type,
							users: [user._id],
							timestamp: timestampMs,
						},
					);

					// Sync media items
					await ctx.runMutation(
						internal.media_items.syncMediaItemsForPostInternal,
						{
							post_id: postId,
							media_items: post.media_items,
						},
					);

					newPosts++;
				}

				// Update user's last_scraped_at
				await ctx.runMutation(internal.users.updateLastScrapedAtInternal, {
					id: user._id,
					lastScrapedAt: Date.now(),
				});

				usersProcessed++;

				// Delay between users (10-30 seconds)
				const delay = Math.floor(Math.random() * 20000) + 10000;
				await new Promise((resolve) => setTimeout(resolve, delay));
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Unknown error";
				errors.push(`User ${user.username}: ${message}`);
			}
		}

		return {
			usersProcessed,
			newPosts,
			errors: errors.length > 0 ? errors : undefined,
		};
	},
});
