import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
	getRandomDelayBetweenUsers,
	resolveInstagramConfig,
	resolveTelegramConfig,
} from "./lib/config";

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
		// Get settings and resolve config with defaults
		const settings = await ctx.runQuery(internal.settings.getSettingsInternal);
		const config = resolveTelegramConfig(settings?.telegram);

		if (!config.active) {
			return { skipped: true };
		}

		if (!config.groupChatId) {
			return { skipped: true, errors: ["No group_chat_id configured"] };
		}

		const botToken = process.env.TELEGRAM_BOT_TOKEN;
		if (!botToken) {
			return { skipped: true, errors: ["TELEGRAM_BOT_TOKEN not configured"] };
		}

		const chatId = config.groupChatId;
		const limit = config.sendLimit;

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
					botToken,
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
						if (fileInfo && mediaItem?.url) {
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
			await new Promise((resolve) =>
				setTimeout(resolve, config.delayBetweenPostsMs),
			);
		}

		return { sent, failed, errors: errors.length > 0 ? errors : undefined };
	},
});

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
		// Get settings and resolve config with defaults
		const settings = await ctx.runQuery(internal.settings.getSettingsInternal);
		const config = resolveInstagramConfig(settings?.instagram);

		if (!config.active) {
			return { skipped: true };
		}

		// Get users to scrape (respecting minimum interval)
		const users = await ctx.runQuery(internal.users.listToBeScrapedInternal, {
			limit: config.userLimit,
			minIntervalMs: config.minScrapeIntervalMs,
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
						limit: config.postsPerUser,
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

				// Delay between users (configurable, default 10-30 seconds)
				const delay = getRandomDelayBetweenUsers(config);
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
		const botToken = process.env.TELEGRAM_BOT_TOKEN;
		if (!botToken) {
			return; // Can't send without token
		}

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
			botToken,
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
					if (fileInfo && mediaItem?.url) {
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
