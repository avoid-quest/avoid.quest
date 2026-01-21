import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Get all Telegram messages for a post
 */
export const getMessagesByPostId = internalQuery({
	args: { postId: v.id("posts") },
	handler: async (ctx, { postId }) =>
		await ctx.db
			.query("telegram_messages")
			.withIndex("by_post_id", (q) => q.eq("post_id", postId))
			.collect(),
});

/**
 * Get a Telegram message by message_id and chat_id
 */
export const getMessageByIdAndChat = internalQuery({
	args: {
		message_id: v.number(),
		chat_id: v.string(),
	},
	handler: async (ctx, { message_id, chat_id }) =>
		await ctx.db
			.query("telegram_messages")
			.withIndex("by_message_id_chat_id", (q) =>
				q.eq("message_id", message_id).eq("chat_id", chat_id),
			)
			.first(),
});

/**
 * Record a sent Telegram message
 */
export const recordMessage = internalMutation({
	args: {
		post_id: v.id("posts"),
		message_id: v.number(),
		chat_id: v.string(),
		sentAt: v.number(),
	},
	handler: async (ctx, { post_id, message_id, chat_id, sentAt }) => {
		// Validate that the post exists
		const post = await ctx.db.get(post_id);
		if (!post) {
			throw new Error(`Post ${post_id} not found`);
		}

		// Check if message already recorded (idempotency)
		const existing = await ctx.db
			.query("telegram_messages")
			.withIndex("by_message_id_chat_id", (q) =>
				q.eq("message_id", message_id).eq("chat_id", chat_id),
			)
			.first();

		if (existing) {
			return existing._id;
		}

		return await ctx.db.insert("telegram_messages", {
			post_id,
			message_id,
			chat_id,
			sentAt,
		});
	},
});

/**
 * Delete a Telegram message record
 */
export const deleteMessage = internalMutation({
	args: { id: v.id("telegram_messages") },
	handler: async (ctx, { id }) => await ctx.db.delete(id),
});
