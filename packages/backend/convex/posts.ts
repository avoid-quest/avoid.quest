import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { secondsToMilliseconds } from "./lib/dateUtils";

export const getPosts = query({
	args: { limit: v.number() },
	handler: async (ctx, { limit }) =>
		await ctx.db
			.query("posts")
			.withIndex("by_event_date")
			.order("desc")
			.take(limit ?? 10),
});

export type Identity<T> = { [P in keyof T]: T[P] };
export type Replace<T, K extends keyof T, TReplace> = Identity<
	Pick<T, Exclude<keyof T, K>> & {
		[P in K]: TReplace;
	}
>;

export const getPostById = query({
	args: { id: v.id("posts") },
	handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const getPostsByUserId = query({
	args: { userId: v.id("users") },
	handler: async (ctx, { userId }) =>
		await ctx.db
			.query("posts")
			.withIndex("by_user_id", (q) => q.eq("users", [userId]))
			.collect(),
});

export const getPostByShortcode = query({
	args: { shortcode: v.string() },
	handler: async (ctx, { shortcode }) =>
		await ctx.db
			.query("posts")
			.withIndex("by_shortcode", (q) => q.eq("shortcode", shortcode))
			.first(),
});

export const getUnsent = query({
	args: { limit: v.number() },
	handler: async (ctx, { limit }) =>
		await ctx.db
			.query("posts")
			.withIndex("by_sent", (q) => q.eq("sent", false))
			.take(limit),
});

export const getPostsPaginated = query({
	args: { paginationOpts: paginationOptsValidator },
	returns: v.object({
		page: v.array(
			v.object({
				_id: v.id("posts"),
				_creationTime: v.number(),
				ig_id: v.string(),
				shortcode: v.string(),
				display_url: v.string(),
				video_url: v.optional(v.string()),
				thumbnail_url: v.optional(v.string()),
				caption: v.string(),
				is_video: v.boolean(),
				url: v.string(),
				media_type: v.union(
					v.literal("image"),
					v.literal("video"),
					v.literal("carousel"),
				),
				users: v.array(v.id("users")),
				timestamp: v.number(),
				event_date: v.optional(v.number()),
				sent: v.optional(v.boolean()),
				sentAt: v.optional(v.number()),
			}),
		),
		isDone: v.boolean(),
		continueCursor: v.union(v.string(), v.null()),
	}),
	handler: async (ctx, { paginationOpts }) => {
		const result = await ctx.db
			.query("posts")
			.withIndex("by_event_date")
			.order("desc")
			.paginate(paginationOpts);
		return {
			page: result.page,
			isDone: result.isDone,
			continueCursor: result.continueCursor,
		};
	},
});

export const getUnsentPaginated = query({
	args: { paginationOpts: paginationOptsValidator },
	returns: v.object({
		page: v.array(
			v.object({
				_id: v.id("posts"),
				_creationTime: v.number(),
				ig_id: v.string(),
				shortcode: v.string(),
				display_url: v.string(),
				video_url: v.optional(v.string()),
				thumbnail_url: v.optional(v.string()),
				caption: v.string(),
				is_video: v.boolean(),
				url: v.string(),
				media_type: v.union(
					v.literal("image"),
					v.literal("video"),
					v.literal("carousel"),
				),
				users: v.array(v.id("users")),
				timestamp: v.number(),
				event_date: v.optional(v.number()),
				sent: v.optional(v.boolean()),
				sentAt: v.optional(v.number()),
			}),
		),
		isDone: v.boolean(),
		continueCursor: v.union(v.string(), v.null()),
	}),
	handler: async (ctx, { paginationOpts }) => {
		const result = await ctx.db
			.query("posts")
			.withIndex("by_sent", (q) => q.eq("sent", false))
			.order("desc")
			.paginate(paginationOpts);
		return {
			page: result.page,
			isDone: result.isDone,
			continueCursor: result.continueCursor,
		};
	},
});

export const upsertPost = mutation({
	args: {
		id: v.optional(v.id("posts")),
		ig_id: v.string(),
		shortcode: v.string(),
		display_url: v.string(),
		video_url: v.optional(v.string()),
		thumbnail_url: v.optional(v.string()),
		caption: v.string(),
		is_video: v.boolean(),
		url: v.string(),
		media_type: v.union(
			v.literal("image"),
			v.literal("video"),
			v.literal("carousel"),
		),
		users: v.array(v.id("users")),
		timestamp: v.number(),
		event_date: v.optional(v.number()),
		sent: v.optional(v.boolean()),
		sentAt: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{
			id,
			ig_id,
			shortcode,
			display_url,
			video_url,
			thumbnail_url,
			caption,
			is_video,
			url,
			media_type,
			users,
			timestamp,
			event_date,
			sent,
			sentAt,
		},
	) => {
		// Convert timestamp from seconds (Instagram API format) to milliseconds (internal standard)
		// The adapter sends timestamps in seconds, but we store them in milliseconds
		const timestampMs = secondsToMilliseconds(timestamp);
		const eventDateMs = event_date
			? secondsToMilliseconds(event_date)
			: undefined;
		const sentAtMs = sentAt ? secondsToMilliseconds(sentAt) : undefined;

		if (id) {
			// Update existing post - preserve sent, sentAt, and event_date if not provided
			const existing = await ctx.db.get(id);
			if (!existing) {
				throw new Error(`Post with id ${id} not found`);
			}

			// Merge users arrays - add new users if they don't already exist
			const existingUsers = existing.users ?? [];
			const mergedUsers = [...new Set([...existingUsers, ...users])];

			// Only update sent/sentAt/event_date if explicitly provided (not undefined)
			const patchData: {
				ig_id: string;
				shortcode: string;
				display_url: string;
				video_url?: string;
				thumbnail_url?: string;
				caption: string;
				is_video: boolean;
				url: string;
				media_type: "image" | "video" | "carousel";
				users: Array<Id<"users">>;
				timestamp: number;
				event_date?: number;
				sent?: boolean;
				sentAt?: number;
			} = {
				ig_id,
				shortcode,
				display_url,
				video_url,
				thumbnail_url,
				caption,
				is_video,
				url,
				media_type,
				users: mergedUsers,
				timestamp: timestampMs,
			};

			// Only patch optional fields if they are explicitly provided
			if (event_date !== undefined) {
				patchData.event_date = eventDateMs;
			}
			if (sent !== undefined) {
				patchData.sent = sent;
			}
			if (sentAt !== undefined) {
				patchData.sentAt = sentAtMs;
			}

			await ctx.db.patch(id, patchData);
			return id;
		}
		return await ctx.db.insert("posts", {
			ig_id,
			shortcode,
			display_url,
			video_url,
			thumbnail_url,
			caption,
			is_video,
			url,
			media_type,
			users,
			timestamp: timestampMs,
			event_date: eventDateMs,
			sent: sent ?? false,
			sentAt: sentAtMs,
		});
	},
});

export const deletePost = mutation({
	args: { id: v.id("posts") },
	handler: async (ctx, { id }) => await ctx.db.delete(id),
});

export const markSent = mutation({
	args: { id: v.id("posts"), sentAt: v.number() },
	handler: async (ctx, { id, sentAt }) => {
		// sentAt is already in milliseconds (Date.now() returns milliseconds)
		// Store directly without conversion
		await ctx.db.patch(id, { sent: true, sentAt });
		return null;
	},
});
