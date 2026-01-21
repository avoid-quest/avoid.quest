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

				// Save file_ids for each media item (matched by position)
				if (result.fileIds && result.fileIds.length > 0) {
					// Filter to get only the media items we sent (exclude thumbnails)
					const sentMediaItems = mediaItems.filter(
						(item) => item.type !== "thumbnail" && item.url,
					);

					for (let i = 0; i < result.fileIds.length; i++) {
						const fileInfo = result.fileIds[i];
						const mediaItem = sentMediaItems[i];
						if (mediaItem?.url) {
							await ctx.runMutation(
								internal.media_items.updateMediaItemWithFileIdInternal,
								{
									post_id: post._id,
									url: mediaItem.url,
									file_id: fileInfo.file_id,
									file_unique_id: fileInfo.file_unique_id,
								},
							);
						}
					}
				}

				sent++;
			} else {
				// If rate limited, schedule retry after the specified delay
				if (result.retryAfterMs) {
					await ctx.scheduler.runAfter(
						result.retryAfterMs,
						internal.crons.retrySinglePost,
						{ postId: post._id, chatId },
					);
					// Don't count as failed - it's queued for retry
					errors.push(`Post ${post.shortcode}: Rate limited, scheduled retry`);
				} else {
					failed++;
					errors.push(`Post ${post.shortcode}: ${result.error}`);
				}
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

/**
 * Retry sending a single post to Telegram
 * Called by scheduler when rate-limited posts need to be retried
 */
export const retrySinglePost = internalAction({
	args: {
		postId: v.id("posts"),
		chatId: v.string(),
	},
	handler: async (ctx, { postId, chatId }) => {
		// Get the post
		const post = await ctx.runQuery(internal.posts.getPostByIdInternal, {
			id: postId,
		});

		// Skip if post doesn't exist or already sent
		if (!post || post.sent) {
			return;
		}

		// Get media items for this post
		const mediaItems = await ctx.runQuery(
			internal.media_items.getMediaItemsByPostIdInternal,
			{ postId },
		);

		// Send via Telegram component
		const result = await ctx.runAction(components.telegram.sender.sendMessage, {
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
		});

		if (result.success) {
			// Mark post as sent
			await ctx.runMutation(internal.posts.markSentInternal, {
				id: postId,
				sentAt: Date.now(),
			});

			// Save file_ids for each media item (matched by position)
			if (result.fileIds && result.fileIds.length > 0) {
				const sentMediaItems = mediaItems.filter(
					(item) => item.type !== "thumbnail" && item.url,
				);

				for (let i = 0; i < result.fileIds.length; i++) {
					const fileInfo = result.fileIds[i];
					const mediaItem = sentMediaItems[i];
					if (mediaItem?.url) {
						await ctx.runMutation(
							internal.media_items.updateMediaItemWithFileIdInternal,
							{
								post_id: postId,
								url: mediaItem.url,
								file_id: fileInfo.file_id,
								file_unique_id: fileInfo.file_unique_id,
							},
						);
					}
				}
			}
		}
		// If still failing, the next cron run will pick it up
	},
});
