import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Get all Telegram messages for a post
 */
export const getMessagesByPostId = query({
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
export const getMessageByIdAndChat = query({
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
export const recordMessage = mutation({
	args: {
		post_id: v.id("posts"),
		message_id: v.number(),
		chat_id: v.string(),
		sent_at: v.number(),
	},
	handler: async (ctx, { post_id, message_id, chat_id, sent_at }) => {
		// Check if message already recorded
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
			sent_at,
		});
	},
});

/**
 * Delete a Telegram message record
 */
export const deleteMessage = mutation({
	args: { id: v.id("telegram_messages") },
	handler: async (ctx, { id }) => await ctx.db.delete(id),
});
