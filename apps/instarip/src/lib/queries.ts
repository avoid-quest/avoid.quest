import "server-only";
import { getDb } from "./turso";
import type {
  MediaItem,
  Post,
  User,
  VirtualScrollParams,
  VirtualScrollResult,
} from "./types";

export const getPostById = async (id: number): Promise<Post | null> => {
  const db = getDb();
  return (
    (await db
      .selectFrom("posts_table")
      .selectAll()
      .where("int_id", "=", id)
      .executeTakeFirst()) ?? null
  );
};

export const getPostByShortcode = async (
  shortcode: string
): Promise<Post | null> => {
  const db = getDb();
  return (
    (await db
      .selectFrom("posts_table")
      .selectAll()
      .where("shortcode", "=", shortcode)
      .executeTakeFirst()) ?? null
  );
};

export const getPostByShortcodeWithUsername = async (
  shortcode: string
): Promise<(Post & { username: string }) | null> => {
  const db = getDb();
  return (
    (await db
      .selectFrom("posts_table")
      .innerJoin(
        "post_users_table",
        "posts_table.int_id",
        "post_users_table.post_id"
      )
      .innerJoin("users_table", "post_users_table.user_id", "users_table.id")
      .select([
        "posts_table.int_id",
        "posts_table.id",
        "posts_table.shortcode",
        "posts_table.display_url",
        "posts_table.video_url",
        "posts_table.thumbnail_url",
        "posts_table.caption",
        "posts_table.is_video",
        "posts_table.url",
        "posts_table.media_type",
        "posts_table.timestamp",
        "posts_table.event_date",
        "posts_table.sent",
        "posts_table.sentAt",
        "posts_table.createdAt",
        "posts_table.updatedAt",
        "users_table.username",
      ])
      .where("posts_table.shortcode", "=", shortcode)
      .where("post_users_table.user_type", "=", "owner")
      .executeTakeFirst()) ?? null
  );
};

export const getMediaItemByPostId = async (
  postId: number
): Promise<MediaItem[]> => {
  const db = getDb();
  return await db
    .selectFrom("media_items_table")
    .selectAll()
    .where("post_id", "=", postId)
    .execute();
};

export const getUserByUsername = async (
  username: string
): Promise<User | null> => {
  const db = getDb();
  return (
    (await db
      .selectFrom("users_table")
      .selectAll()
      .where("username", "=", username)
      .executeTakeFirst()) ?? null
  );
};

export const getUserById = async (id: number): Promise<User | null> => {
  const db = getDb();
  return (
    (await db
      .selectFrom("users_table")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()) ?? null
  );
};

export const getPostsByUserId = async (userId: number): Promise<Post[]> => {
  const db = getDb();
  return await db
    .selectFrom("posts_table")
    .innerJoin(
      "post_users_table",
      "posts_table.int_id",
      "post_users_table.post_id"
    )
    .selectAll("posts_table")
    .where("post_users_table.user_id", "=", userId)
    .where("post_users_table.user_type", "=", "owner")
    .orderBy("posts_table.timestamp", "desc")
    .execute();
};

export const getUserWithPostCount = async (
  username: string
): Promise<
  | (Omit<User, "to_be_scraped" | "last_scraped_at"> & { postCount: number })
  | null
> => {
  const db = getDb();
  const result = await db
    .selectFrom("users_table")
    .leftJoin("post_users_table", "users_table.id", "post_users_table.user_id")
    .leftJoin("posts_table", "post_users_table.post_id", "posts_table.int_id")
    .select([
      "users_table.id",
      "users_table.username",
      "users_table.profile_url",
      "users_table.createdAt",
      "users_table.updatedAt",
      db.fn.count("posts_table.int_id").as("postCount"),
    ])
    .where("users_table.username", "=", username)
    .where("post_users_table.user_type", "=", "owner")
    .groupBy("users_table.id")
    .executeTakeFirst();

  return result ? { ...result, postCount: Number(result.postCount) } : null;
};

export const getAllUsers = async (): Promise<User[]> => {
  const db = getDb();
  return await db.selectFrom("users_table").selectAll().execute();
};

export const getAllPosts = async (): Promise<Post[]> => {
  const db = getDb();
  return await db
    .selectFrom("posts_table")
    .selectAll()
    .orderBy("timestamp", "desc")
    .execute();
};

export const getPostsWithUsernames = async (): Promise<
  (Post & { username: string })[]
> => {
  const db = getDb();
  return await db
    .selectFrom("posts_table")
    .innerJoin(
      "post_users_table",
      "posts_table.int_id",
      "post_users_table.post_id"
    )
    .innerJoin("users_table", "post_users_table.user_id", "users_table.id")
    .select([
      "posts_table.int_id",
      "posts_table.id",
      "posts_table.shortcode",
      "posts_table.display_url",
      "posts_table.video_url",
      "posts_table.thumbnail_url",
      "posts_table.caption",
      "posts_table.is_video",
      "posts_table.url",
      "posts_table.media_type",
      "posts_table.timestamp",
      "posts_table.event_date",
      "posts_table.sent",
      "posts_table.sentAt",
      "posts_table.createdAt",
      "posts_table.updatedAt",
      "users_table.username",
    ])
    .where("post_users_table.user_type", "=", "owner")
    .orderBy("posts_table.timestamp", "desc")
    .execute();
};

/**
 * Performance monitoring utility for queries
 */
export async function timedQuery<T>(
  queryName: string,
  queryFn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  const result = await queryFn();
  const duration = performance.now() - start;

  // Performance logging - can be replaced with proper logging service
  if (process.env.NODE_ENV === "development") {
    // Use process.stdout instead of console for better performance
    process.stdout.write(`Query ${queryName} took ${duration.toFixed(2)}ms\n`);
  }
  return result;
}

/**
 * Virtual scrolling queries for efficient infinite loading
 */

export const getVirtualPostsWithUsernames = async (
  params: VirtualScrollParams = {}
): Promise<VirtualScrollResult<Post & { username: string }>> => {
  const db = getDb();
  const { offset = 0, limit = 20 } = params;

  // Get posts with usernames
  const posts = await db
    .selectFrom("posts_table")
    .innerJoin(
      "post_users_table",
      "posts_table.int_id",
      "post_users_table.post_id"
    )
    .innerJoin("users_table", "post_users_table.user_id", "users_table.id")
    .select([
      "posts_table.int_id",
      "posts_table.id",
      "posts_table.shortcode",
      "posts_table.display_url",
      "posts_table.video_url",
      "posts_table.thumbnail_url",
      "posts_table.caption",
      "posts_table.is_video",
      "posts_table.url",
      "posts_table.media_type",
      "posts_table.timestamp",
      "posts_table.event_date",
      "posts_table.sent",
      "posts_table.sentAt",
      "posts_table.createdAt",
      "posts_table.updatedAt",
      "users_table.username",
    ])
    .where("post_users_table.user_type", "=", "owner")
    .orderBy("posts_table.timestamp", "desc")
    .limit(limit + 1) // Get one extra to check if there's more
    .offset(offset)
    .execute();

  // Check if there are more items
  const hasMore = posts.length > limit;
  const data = hasMore ? posts.slice(0, limit) : posts;

  return {
    data: data as (Post & { username: string })[],
    hasMore,
  };
};

export const getVirtualPostsByUserId = async (
  userId: number,
  params: VirtualScrollParams = {}
): Promise<VirtualScrollResult<Post & { username: string }>> => {
  const db = getDb();
  const { offset = 0, limit = 20 } = params;

  // Get posts for specific user
  const posts = await db
    .selectFrom("posts_table")
    .innerJoin(
      "post_users_table",
      "posts_table.int_id",
      "post_users_table.post_id"
    )
    .innerJoin("users_table", "post_users_table.user_id", "users_table.id")
    .select([
      "posts_table.int_id",
      "posts_table.id",
      "posts_table.shortcode",
      "posts_table.display_url",
      "posts_table.video_url",
      "posts_table.thumbnail_url",
      "posts_table.caption",
      "posts_table.is_video",
      "posts_table.url",
      "posts_table.media_type",
      "posts_table.timestamp",
      "posts_table.event_date",
      "posts_table.sent",
      "posts_table.sentAt",
      "posts_table.createdAt",
      "posts_table.updatedAt",
      "users_table.username",
    ])
    .where("post_users_table.user_id", "=", userId)
    .where("post_users_table.user_type", "=", "owner")
    .orderBy("posts_table.timestamp", "desc")
    .limit(limit + 1) // Get one extra to check if there's more
    .offset(offset)
    .execute();

  // Check if there are more items
  const hasMore = posts.length > limit;
  const data = hasMore ? posts.slice(0, limit) : posts;

  return {
    data: data as (Post & { username: string })[],
    hasMore,
  };
};
