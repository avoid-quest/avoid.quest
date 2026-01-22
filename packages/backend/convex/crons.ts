import { cronJobs } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import type { Doc, Id } from "./components/instarip/_generated/dataModel";
import { InMemoryRateLimiter } from "./components/instarip/lib/rateLimiter";
import type { SendResult } from "./components/telegram/sender";
import {
	getRandomDelayBetweenUsers,
	resolveInstagramConfig,
	resolveTelegramConfig,
} from "./lib/config";
import { saveFileIdsForPost } from "./lib/fileIdMatcher";
import { createLogger } from "./lib/logger";

const logger = createLogger("crons");

/**
 * Type aliases for component document types
 */
type MediaItem = Doc<"media_items">;
type Post = Doc<"posts">;

const MAX_RETRY_COUNT = 3;

/**
 * Result of attempting to send a post to Telegram
 */
type SendPostResult = {
	success: boolean;
	error?: string;
	retryAfterMs?: number;
};

/**
 * Send a single post to Telegram.
 * Encapsulates the common logic for sending, marking as sent, and saving file IDs.
 *
 * @param ctx - Action context for running queries/mutations/actions
 * @param postId - The post ID to send
 * @param post - The post data (must include caption, url, and media URLs)
 * @param botToken - Telegram bot token
 * @param chatId - Telegram chat ID to send to
 * @returns Result indicating success or failure with optional retry info
 */
async function sendPostToTelegram(
	ctx: ActionCtx,
	postId: Id<"posts"> | string,
	post: {
		caption: string;
		url: string;
		display_url: string;
		video_url?: string;
		is_video: boolean;
		media_type: "image" | "video" | "carousel";
	},
	botToken: string,
	chatId: string,
): Promise<SendPostResult> {
	// Get media items for this post
	const mediaItems: MediaItem[] = await ctx.runQuery(
		components.instarip.mediaItems.getMediaItemsByPostId,
		{ postId },
	);

	// Build media items for Telegram
	// For items with telegram_file, use file_id-based sending
	// For items without telegram_file, use post's display_url/video_url for single-item posts
	const isSendableMedia = (
		item: MediaItem,
	): item is MediaItem & { type: "image" | "video" } =>
		item.type === "image" || item.type === "video";

	const telegramMediaItems = mediaItems
		.filter(isSendableMedia)
		.map((item) => {
			// If we have complete telegram_file data, use it (preferred)
			if (item.telegram_file) {
				return {
					file_id: item.telegram_file.file_id,
					file_unique_id: item.telegram_file.file_unique_id,
					type: item.type,
					width: item.width,
					height: item.height,
				};
			}
			// For single-item posts without telegram_file, use post's media URLs
			if (post.media_type !== "carousel") {
				const url =
					item.type === "video"
						? (post.video_url ?? post.display_url)
						: post.display_url;
				return {
					url,
					type: item.type,
					width: item.width,
					height: item.height,
				};
			}
			// For carousel items without telegram_file, we can't send them (URLs not stored)
			// Return null and filter out below
			return null;
		})
		.filter((item): item is NonNullable<typeof item> => item !== null);

	// Send via Telegram component
	const result: SendResult = await ctx.runAction(
		components.telegram.sender.sendMessage,
		{
			botToken,
			chatId,
			caption: post.caption,
			mediaItems: telegramMediaItems,
			postUrl: post.url,
		},
	);

	if (result.success) {
		// Mark post as sent (transitions from "sending" to "sent")
		await ctx.runMutation(components.instarip.posts.markSent, {
			id: postId,
			sentAt: Date.now(),
		});

		// Save file_ids for each media item (matched by position)
		if (result.fileIds && result.fileIds.length > 0) {
			await saveFileIdsForPost(ctx, postId, mediaItems, result.fileIds);
		}

		return { success: true };
	}

	// Clear sending flag on failure
	await ctx.runMutation(components.instarip.posts.clearSending, {
		id: postId,
	});

	return {
		success: false,
		error: result.error,
		retryAfterMs: result.retryAfterMs,
	};
}

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

// Log cleanup cron - runs daily at 3 AM UTC
crons.cron("cleanup old fetch logs", "0 3 * * *", internal.crons.runLogCleanup);

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
		const settings = await ctx.runQuery(
			components.instarip.settings.getSettings,
			{},
		);
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
		const posts = await ctx.runQuery(components.instarip.posts.getUnsent, {
			limit,
		});

		if (posts.length === 0) {
			return { sent: 0, failed: 0 };
		}

		let sent = 0;
		let failed = 0;
		const errors: string[] = [];

		for (let i = 0; i < posts.length; i++) {
			const post = posts[i];

			// Claim the post for sending (prevents concurrent sends)
			const claimed = await ctx.runMutation(
				components.instarip.posts.claimForSending,
				{ id: post._id },
			);
			if (!claimed) {
				// Already being sent by another process, skip
				continue;
			}

			try {
				// Send using shared helper
				const result = await sendPostToTelegram(
					ctx,
					post._id,
					{
						caption: post.caption,
						url: post.url,
						display_url: post.display_url,
						video_url: post.video_url,
						is_video: post.is_video,
						media_type: post.media_type,
					},
					botToken,
					chatId,
				);

				if (result.success) {
					sent++;
				} else {
					// If rate limited, break the loop and schedule retry for remaining posts
					if (result.retryAfterMs) {
						// Schedule retry for THIS post
						await ctx.scheduler.runAfter(
							result.retryAfterMs,
							internal.crons.retrySinglePost,
							{ postId: post._id, chatId },
						);

						// Schedule retry for REMAINING posts (don't continue loop)
						const remainingPosts = posts.slice(i + 1);
						if (remainingPosts.length > 0) {
							await ctx.scheduler.runAfter(
								result.retryAfterMs,
								internal.crons.retryBatch,
								{
									postIds: remainingPosts.map((p: Post) => p._id),
									chatId,
								},
							);
						}

						errors.push(
							`Post ${post.shortcode}: Rate limited, scheduled retry for ${remainingPosts.length + 1} posts`,
						);
						break; // Exit loop
					}
					failed++;
					errors.push(`Post ${post.shortcode}: ${result.error}`);
				}
			} catch (error) {
				// Clear sending flag on error
				await ctx.runMutation(components.instarip.posts.clearSending, {
					id: post._id,
				});
				failed++;
				errors.push(
					`Post ${post.shortcode}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}

			// Small delay between posts to avoid rate limiting
			await new Promise((resolve) =>
				setTimeout(resolve, config.delayBetweenPostsMs),
			);
		}

		return { sent, failed, errors: errors.length > 0 ? errors : undefined };
	},
});

/**
 * Orchestration layer for Instagram fetching
 * Fetches posts for users marked as to_be_scraped via the Instarip component
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
		const settings = await ctx.runQuery(
			components.instarip.settings.getSettings,
			{},
		);
		const config = resolveInstagramConfig(settings?.instagram);

		if (!config.active) {
			return { skipped: true };
		}

		// Get users to scrape (respecting minimum interval)
		const users = await ctx.runQuery(
			components.instarip.users.listToBeScrapedWithInterval,
			{
				limit: config.userLimit,
				minIntervalMs: config.minScrapeIntervalMs,
			},
		);

		if (users.length === 0) {
			return { usersProcessed: 0, newPosts: 0 };
		}

		// Initialize rate limiter with config values
		const rateLimiter = new InMemoryRateLimiter(
			config.rateLimitMaxTokens,
			config.rateLimitRefillRate,
		);

		let usersProcessed = 0;
		let newPosts = 0;
		const errors: string[] = [];

		for (const user of users) {
			try {
				// Wait for rate limiter before fetching
				await rateLimiter.consumeToken();

				// Fetch posts via Instarip component fetcher
				const result = await ctx.runAction(
					components.instarip.fetcher.fetchUser,
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
					try {
						// Check if post already exists
						const existing = await ctx.runQuery(
							components.instarip.posts.getPostByShortcode,
							{ shortcode: post.shortcode },
						);

						if (existing) {
							// Post already exists, skip
							continue;
						}

						// Upsert the post (timestamp already in ms from adapter)
						const postId = await ctx.runMutation(
							components.instarip.posts.upsertPost,
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
								timestamp: post.timestamp,
							},
						);

						// Sync media items
						await ctx.runMutation(
							components.instarip.mediaItems.syncMediaItemsForPost,
							{
								post_id: postId,
								media_items: post.media_items,
							},
						);

						newPosts++;
					} catch (postError) {
						// Log individual post failure but continue processing other posts
						const message =
							postError instanceof Error ? postError.message : "Unknown error";
						errors.push(
							`User ${user.username} post ${post.shortcode}: ${message}`,
						);
					}
				}

				// Update user's last_scraped_at
				await ctx.runMutation(components.instarip.users.updateLastScrapedAt, {
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
		postId: v.string(),
		chatId: v.string(),
	},
	handler: async (ctx, { postId, chatId }) => {
		const botToken = process.env.TELEGRAM_BOT_TOKEN;
		if (!botToken) {
			logger.error("retrySinglePost: TELEGRAM_BOT_TOKEN not configured");
			return;
		}

		// Get the post
		const post = await ctx.runQuery(components.instarip.posts.getPostById, {
			id: postId,
		});

		// Skip if post doesn't exist or already sent
		if (!post) {
			logger.warn(`retrySinglePost: Post ${postId} not found`);
			return;
		}

		if (post.status === "sent") {
			// Already sent, no action needed (not an error)
			return;
		}

		if (post.status === "failed") {
			// Permanently failed, don't retry
			logger.warn(
				`retrySinglePost: Post ${post.shortcode} permanently failed, skipping`,
			);
			return;
		}

		// Increment retry count and check if we've exceeded max retries
		const retryCount = await ctx.runMutation(
			components.instarip.posts.incrementRetryCount,
			{ id: postId },
		);

		if (retryCount > MAX_RETRY_COUNT) {
			// Mark as permanently failed
			await ctx.runMutation(components.instarip.posts.markSendFailed, {
				id: postId,
			});
			logger.warn(
				`retrySinglePost: Post ${post.shortcode} permanently failed after ${MAX_RETRY_COUNT} attempts`,
			);
			return;
		}

		// Claim the post for sending (prevents concurrent sends)
		const claimed = await ctx.runMutation(
			components.instarip.posts.claimForSending,
			{ id: postId },
		);
		if (!claimed) {
			// Already being sent by another process
			return;
		}

		try {
			// Send using shared helper
			const result = await sendPostToTelegram(
				ctx,
				postId,
				{
					caption: post.caption,
					url: post.url,
					display_url: post.display_url,
					video_url: post.video_url,
					is_video: post.is_video,
					media_type: post.media_type,
				},
				botToken,
				chatId,
			);

			if (!result.success) {
				// If rate limited, schedule another retry
				if (result.retryAfterMs) {
					await ctx.scheduler.runAfter(
						result.retryAfterMs,
						internal.crons.retrySinglePost,
						{ postId, chatId },
					);
					logger.info(
						`retrySinglePost: Post ${post.shortcode} rate limited, retry ${retryCount}/${MAX_RETRY_COUNT} scheduled`,
					);
				} else {
					logger.warn(
						`retrySinglePost: Failed to send post ${post.shortcode} (attempt ${retryCount}): ${result.error}`,
					);
				}
			}
		} catch (error) {
			// Clear sending flag on error
			await ctx.runMutation(components.instarip.posts.clearSending, {
				id: postId,
			});
			logger.error(
				`retrySinglePost: Error sending post ${post.shortcode}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	},
});

/**
 * Retry sending a batch of posts to Telegram
 * Called by scheduler when rate limiting causes early exit from the main loop
 */
export const retryBatch = internalAction({
	args: {
		postIds: v.array(v.string()),
		chatId: v.string(),
	},
	handler: async (ctx, { postIds, chatId }) => {
		const botToken = process.env.TELEGRAM_BOT_TOKEN;
		if (!botToken) {
			logger.error("retryBatch: TELEGRAM_BOT_TOKEN not configured");
			return;
		}

		const settings = await ctx.runQuery(
			components.instarip.settings.getSettings,
			{},
		);
		const config = resolveTelegramConfig(settings?.telegram);

		for (const postId of postIds) {
			// Delegate to retrySinglePost (which handles claiming, retry counting, etc.)
			await ctx.runAction(internal.crons.retrySinglePost, { postId, chatId });

			// Small delay between posts to avoid rate limiting
			await new Promise((resolve) =>
				setTimeout(resolve, config.delayBetweenPostsMs),
			);
		}
	},
});

/**
 * Log cleanup action - removes old fetch logs based on retention settings.
 * Runs repeatedly until all old logs are cleaned up.
 */
export const runLogCleanup = internalAction({
	args: {},
	returns: v.object({
		deletedTotal: v.number(),
	}),
	handler: async (ctx) => {
		let deletedTotal = 0;
		let deletedBatch: number;

		// Keep running cleanup until no more logs to delete
		do {
			deletedBatch = await ctx.runMutation(
				components.instarip.fetcher.cleanupOldLogs,
				{},
			);
			deletedTotal += deletedBatch;
		} while (deletedBatch > 0);

		if (deletedTotal > 0) {
			logger.info(`runLogCleanup: Deleted ${deletedTotal} old fetch logs`);
		}

		return { deletedTotal };
	},
});
