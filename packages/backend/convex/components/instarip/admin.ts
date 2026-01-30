/**
 * Admin mutations for instarip component
 * Internal use only - for data management and cleanup
 */
import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";

/**
 * Wipe all post-related data (posts, media_items, telegram_messages, fetch_logs)
 * Keeps users table intact
 *
 * @internal Use with caution - this permanently deletes data
 */
export const wipeAllPostData = internalMutation({
	args: {},
	handler: async (ctx) => {
		const stats = {
			posts: 0,
			mediaItems: 0,
			telegramMessages: 0,
			fetchLogs: 0,
		};

		// Delete all telegram_messages first (has FK to posts)
		const telegramMessages = await ctx.db.query("telegram_messages").collect();
		for (const msg of telegramMessages) {
			await ctx.db.delete(msg._id);
			stats.telegramMessages++;
		}

		// Delete all media_items (has FK to posts)
		const mediaItems = await ctx.db.query("media_items").collect();
		for (const item of mediaItems) {
			await ctx.db.delete(item._id);
			stats.mediaItems++;
		}

		// Delete all posts
		const posts = await ctx.db.query("posts").collect();
		for (const post of posts) {
			await ctx.db.delete(post._id);
			stats.posts++;
		}

		// Delete all fetch_logs
		const fetchLogs = await ctx.db.query("fetch_logs").collect();
		for (const log of fetchLogs) {
			await ctx.db.delete(log._id);
			stats.fetchLogs++;
		}

		return stats;
	},
});

/**
 * Public mutation for wiping post data (requires confirmation)
 * Pass confirm: true to execute
 */
export const wipePostData = mutation({
	args: {
		confirm: v.boolean(),
	},
	handler: async (ctx, { confirm }) => {
		if (!confirm) {
			return {
				error: "Must pass confirm: true to wipe data",
				wouldDelete: {
					posts: (await ctx.db.query("posts").collect()).length,
					mediaItems: (await ctx.db.query("media_items").collect()).length,
					telegramMessages: (await ctx.db.query("telegram_messages").collect())
						.length,
					fetchLogs: (await ctx.db.query("fetch_logs").collect()).length,
				},
			};
		}

		const stats = {
			posts: 0,
			mediaItems: 0,
			telegramMessages: 0,
			fetchLogs: 0,
		};

		// Delete all telegram_messages first (has FK to posts)
		const telegramMessages = await ctx.db.query("telegram_messages").collect();
		for (const msg of telegramMessages) {
			await ctx.db.delete(msg._id);
			stats.telegramMessages++;
		}

		// Delete all media_items (has FK to posts)
		const mediaItems = await ctx.db.query("media_items").collect();
		for (const item of mediaItems) {
			await ctx.db.delete(item._id);
			stats.mediaItems++;
		}

		// Delete all posts
		const posts = await ctx.db.query("posts").collect();
		for (const post of posts) {
			await ctx.db.delete(post._id);
			stats.posts++;
		}

		// Delete all fetch_logs
		const fetchLogs = await ctx.db.query("fetch_logs").collect();
		for (const log of fetchLogs) {
			await ctx.db.delete(log._id);
			stats.fetchLogs++;
		}

		return { success: true, deleted: stats };
	},
});

/**
 * Get all telegram message IDs for clearing the CDN chat
 * Returns message_id and chat_id pairs
 */
export const getTelegramMessageIds = mutation({
	args: {
		chatId: v.optional(v.string()),
	},
	handler: async (ctx, { chatId }) => {
		const query = ctx.db.query("telegram_messages");

		const messages = await query.collect();

		// Filter by chatId if provided
		const filtered = chatId
			? messages.filter((m) => m.chat_id === chatId)
			: messages;

		return filtered.map((m) => ({
			messageId: m.message_id,
			chatId: m.chat_id,
		}));
	},
});
