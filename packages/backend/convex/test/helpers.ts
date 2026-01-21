/**
 * Shared test utilities for Convex tests
 *
 * Reduces boilerplate in test files by providing common setup patterns
 * and entity creation helpers.
 *
 * Usage in test files:
 * ```ts
 * import { convexTest } from "convex-test";
 * import schema from "../schema";
 * import { createUser, createPost } from "./test/helpers";
 *
 * const modules = import.meta.glob("../**\/*.ts");
 *
 * it("test case", async () => {
 *   const t = convexTest(schema, modules);
 *   const user = await createUser(t);
 *   // ...
 * });
 * ```
 */

import type { TestConvex } from "convex-test";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type schema from "../schema";

/**
 * Type for the test context (convexTest return type)
 */
export type TestContext = TestConvex<typeof schema>;

/**
 * Create a user in the test database
 * Throws if user creation fails
 */
export async function createUser(
	t: TestContext,
	username = `testuser_${Date.now()}`,
): Promise<Doc<"users">> {
	const user = await t.mutation(internal.users.getOrCreateUserInternal, {
		username,
	});
	if (!user) {
		throw new Error(`User ${username} should be created`);
	}
	return user;
}

/**
 * Post creation options
 */
type CreatePostOptions = {
	ig_id?: string;
	shortcode?: string;
	display_url?: string;
	video_url?: string;
	thumbnail_url?: string;
	caption?: string;
	is_video?: boolean;
	url?: string;
	media_type?: "image" | "video" | "carousel";
	timestamp?: number;
	event_date?: number;
};

/**
 * Create a post in the test database
 *
 * Note: Uses upsertPostInternal which expects timestamps in MILLISECONDS
 */
export async function createPost(
	t: TestContext,
	user: Doc<"users">,
	options: CreatePostOptions = {},
): Promise<Id<"posts">> {
	const now = Date.now();
	const shortcode =
		options.shortcode ?? `POST${now.toString(36).toUpperCase()}`;

	return await t.mutation(internal.posts.upsertPostInternal, {
		ig_id: options.ig_id ?? `ig_${now}`,
		shortcode,
		display_url: options.display_url ?? `https://example.com/${now}.jpg`,
		video_url: options.video_url,
		thumbnail_url: options.thumbnail_url,
		caption: options.caption ?? "Test caption",
		is_video: options.is_video ?? false,
		url: options.url ?? `https://instagram.com/p/${shortcode}`,
		media_type: options.media_type ?? "image",
		users: [user._id],
		timestamp: options.timestamp ?? now,
		event_date: options.event_date,
	});
}

/**
 * Media item creation options
 */
type CreateMediaItemOptions = {
	url?: string;
	file_id?: string;
	file_unique_id?: string;
	type?: "image" | "video" | "thumbnail";
	width?: number;
	height?: number;
};

/**
 * Create a media item in the test database
 */
export async function createMediaItem(
	t: TestContext,
	postId: Id<"posts">,
	options: CreateMediaItemOptions = {},
): Promise<Id<"media_items">> {
	const now = Date.now();

	return await t.mutation(internal.media_items.upsertMediaItem, {
		url: options.url ?? `https://example.com/media/${now}.jpg`,
		file_id: options.file_id,
		file_unique_id: options.file_unique_id,
		type: options.type ?? "image",
		width: options.width ?? 1080,
		height: options.height ?? 1080,
		post_id: postId,
	});
}

/**
 * Create a media item with Telegram file_id (migrated item)
 */
export async function createMediaItemWithFileId(
	t: TestContext,
	postId: Id<"posts">,
	options: Omit<CreateMediaItemOptions, "file_id" | "file_unique_id"> = {},
): Promise<Id<"media_items">> {
	const uniqueId =
		Date.now().toString(36) + Math.random().toString(36).slice(2);

	return await createMediaItem(t, postId, {
		...options,
		file_id: `AgACAgIAAxk${uniqueId}`,
		file_unique_id: `AQADAgAT${uniqueId.slice(0, 16)}`,
	});
}

/**
 * Create a media item with only URL (legacy item needing backfill)
 */
export async function createMediaItemUrlOnly(
	t: TestContext,
	postId: Id<"posts">,
	options: Omit<CreateMediaItemOptions, "file_id" | "file_unique_id"> = {},
): Promise<Id<"media_items">> {
	return await createMediaItem(t, postId, {
		...options,
		file_id: undefined,
		file_unique_id: undefined,
	});
}

/**
 * Mark a post as sent
 */
export async function markPostSent(
	t: TestContext,
	postId: Id<"posts">,
	sentAt?: number,
): Promise<void> {
	await t.mutation(internal.posts.markSentInternal, {
		id: postId,
		sentAt: sentAt ?? Date.now(),
	});
}

/**
 * Get post by ID
 */
export async function getPost(
	t: TestContext,
	postId: Id<"posts">,
): Promise<Doc<"posts"> | null> {
	return await t.query(internal.posts.getPostByIdInternal, { id: postId });
}

/**
 * Get media items for a post
 */
export async function getMediaItemsForPost(
	t: TestContext,
	postId: Id<"posts">,
): Promise<Doc<"media_items">[]> {
	return await t.query(internal.media_items.getMediaItemsByPostIdInternal, {
		postId,
	});
}
