import type { Doc, Id } from "@workspace/backend/convex/_generated/dataModel";
import { sleep } from "bun";
import { api, getHttpClient } from "../convex/client";
import { createLogger } from "../infra/logger";
import { TokenBucketLimiter } from "../infra/rate-limiter";
import { getEffectiveSettings } from "../settings";
import { InstagramScraper, type SinglePostResponse } from "./instagram";

type MediaItemLike = Omit<Doc<"media_items">, "_id" | "_creationTime">;
type PostLike = Omit<Doc<"posts">, "_id" | "_creationTime">;

export async function loadUsersToBeScraped(
  limit?: number
): Promise<Doc<"users">[]> {
  return await getHttpClient().query(api.users.listToBeScraped, { limit });
}

export async function upsertPostWithMedia(
  post: PostLike,
  mediaItems: MediaItemLike[]
): Promise<void> {
  const postId = await getHttpClient().mutation(api.posts.upsertPost, post);

  for (const item of mediaItems) {
    await getHttpClient().mutation(api.media_items.upsertMediaItem, {
      ...item,
      post_id: postId,
    });
  }
}

export async function updateUserLastScraped(
  userId: Id<"users">,
  lastScrapedAt: number
): Promise<void> {
  await getHttpClient().mutation(api.users.upsertUser, {
    id: userId,
    to_be_scraped: true,
    last_scraped_at: lastScrapedAt,
  });
}

async function processPost(
  post: {
    shortcode: string;
    id: string;
    timestampSec: number;
    display_url: string;
    video_url?: string;
    thumbnail_url?: string;
    caption: string;
    is_video: boolean;
    url: string;
    media_type: "image" | "video" | "carousel";
    media_items: Array<{
      url: string;
      type: "image" | "video" | "thumbnail";
      width?: number;
      height?: number;
    }>;
  },
  userId: Id<"users">
): Promise<void> {
  const existing = await getHttpClient().query(api.posts.getPostByShortcode, {
    shortcode: post.shortcode,
  });

  // When updating existing posts, don't overwrite sent, sentAt, or event_date
  // Only pass these fields when creating new posts
  const postId = await getHttpClient().mutation(api.posts.upsertPost, {
    id: existing?._id,
    ig_id: post.id,
    shortcode: post.shortcode,
    display_url: post.display_url,
    video_url: post.video_url,
    thumbnail_url: post.thumbnail_url,
    caption: post.caption, // Caption is updated when re-scraping
    is_video: post.is_video,
    url: post.url,
    media_type: post.media_type,
    users: [userId],
    timestamp: post.timestampSec,
    // Don't pass event_date, sent, or sentAt when updating - they will be preserved
    // When creating new posts, these will default to undefined/false
    ...(existing?._id
      ? {}
      : { event_date: undefined, sent: false, sentAt: undefined }),
  });

  // Sync media items: updates existing, adds new, removes deleted ones
  // This ensures media items stay in sync with the scraped data
  await getHttpClient().mutation(api.media_items.syncMediaItemsForPost, {
    post_id: postId,
    media_items: post.media_items,
  });
}

async function processUser(
  user: Doc<"users">,
  opts: {
    postsPerUser: number;
    minIntervalMs: number;
    scraper: InstagramScraper;
    logger: ReturnType<typeof createLogger>;
    msPerMinute: number;
  }
): Promise<boolean> {
  const { postsPerUser, minIntervalMs, scraper, logger, msPerMinute } = opts;
  if (!user.username) {
    return false;
  }

  const last = user.last_scraped_at ?? 0;
  const now = Date.now();
  if (last > 0 && now - last < minIntervalMs) {
    const minutesAgo = Math.round((now - last) / msPerMinute);
    logger.debug(`Skip @${user.username} (scraped ${minutesAgo}m ago)`);
    return false;
  }

  logger.info(`Scraping @${user.username}`);
  const posts = await scraper.getRecent(user.username, postsPerUser);
  logger.debug(`Fetched ${posts.length} posts for @${user.username}`);

  const cvxUser = await getHttpClient().query(api.users.getUserByUsername, {
    username: user.username,
  });
  if (!cvxUser) {
    logger.warn(`User @${user.username} not found in database`);
    return false;
  }

  for (const p of posts) {
    await processPost(p, cvxUser._id);
  }

  await updateUserLastScraped(user._id, now);
  logger.debug(`Updated last_scraped_at for @${user.username}`);
  return true;
}

export async function scrapeOnce(): Promise<void> {
  const settings = await getEffectiveSettings();
  if (!settings.scraper.active) {
    return;
  }

  const DEFAULT_USERS_PER_SESSION = 5;
  const DEFAULT_POSTS_PER_USER = 20;
  const DEFAULT_MIN_INTERVAL_MINUTES = 30;
  const DEFAULT_BURST = 3;
  const DEFAULT_RPS = 0.5;
  const SECONDS_PER_MINUTE = 60;
  const MS_PER_SECOND = 1000;
  const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
  const MIN_USER_DELAY_SECONDS = 10;
  const MAX_USER_DELAY_SECONDS = 30;

  const usersPerSession = settings.scraper.limit ?? DEFAULT_USERS_PER_SESSION;
  const postsPerUser = settings.scraper.post_per_user ?? DEFAULT_POSTS_PER_USER;
  const minIntervalMs = DEFAULT_MIN_INTERVAL_MINUTES * MS_PER_MINUTE;

  const users = await loadUsersToBeScraped();
  const logger = createLogger(
    !!(settings.logging?.active || process.env.DEBUG),
    process.env.DEBUG ? "debug" : "info"
  );
  const limiter = new TokenBucketLimiter(DEFAULT_BURST, DEFAULT_RPS);
  const scraper = new InstagramScraper(
    {
      minDelayMs: 2000,
      maxDelayMs: 5000,
      timeoutMs: 30_000,
      postProcessingDelayMs: 2000,
      postProcessingMaxDelayMs: 5000,
    },
    { limiter, logger }
  );

  logger.info(
    `Scraping up to ${usersPerSession} users (${postsPerUser} posts per user) from ${users.length} candidates`
  );

  let skippedNoUsername = 0;
  let skippedRecently = 0;
  let processedUsers = 0;

  for (const user of users) {
    if (processedUsers >= usersPerSession) {
      logger.debug(`Reached max users limit (${usersPerSession})`);
      break;
    }

    if (!user.username) {
      skippedNoUsername++;
      continue;
    }

    const wasProcessed = await processUser(user, {
      postsPerUser,
      minIntervalMs,
      scraper,
      logger,
      msPerMinute: MS_PER_MINUTE,
    });

    if (wasProcessed) {
      processedUsers++;
    } else {
      skippedRecently++;
    }

    if (processedUsers < usersPerSession) {
      const delaySeconds =
        Math.floor(
          Math.random() * (MAX_USER_DELAY_SECONDS - MIN_USER_DELAY_SECONDS + 1)
        ) + MIN_USER_DELAY_SECONDS;
      logger.debug(`Waiting ${delaySeconds}s before next user...`);
      await sleep(delaySeconds * MS_PER_SECOND);
    }
  }

  logger.info(
    `Scrape finished. Processed: ${processedUsers}, Skipped: ${skippedNoUsername} no username, ${skippedRecently} recently scraped`
  );
}

const POST_USERNAME_PATTERN = /instagram\.com\/([a-zA-Z0-9_.]+)/;

function extractUsernameFromUrl(url: string): string | null {
  const match = url.match(POST_USERNAME_PATTERN);
  if (!match?.[1]) {
    return null;
  }
  // Remove 'p' if it's from a post URL
  const username = match[1];
  return username === "p" ? null : username;
}

export async function scrapeAndSaveSinglePost(
  postUrl: string
): Promise<{ success: boolean; postId?: string; error?: string }> {
  const settings = await getEffectiveSettings();
  const logger = createLogger(
    !!(settings.logging?.active || process.env.DEBUG),
    process.env.DEBUG ? "debug" : "info"
  );

  try {
    // Initialize scraper
    const DEFAULT_BURST = 3;
    const DEFAULT_RPS = 0.5;
    const limiter = new TokenBucketLimiter(DEFAULT_BURST, DEFAULT_RPS);
    const scraper = new InstagramScraper(
      {
        minDelayMs: 2000,
        maxDelayMs: 5000,
        timeoutMs: 30_000,
        postProcessingDelayMs: 2000,
        postProcessingMaxDelayMs: 5000,
      },
      { limiter, logger }
    );

    // Scrape the post
    const result: SinglePostResponse = await scraper.getSinglePost(postUrl);

    if (!result.success) {
      return {
        success: false,
        error: result.error ?? "Failed to scrape post",
      };
    }

    if (!result.post) {
      return {
        success: false,
        error: "No post data returned",
      };
    }

    const post = result.post;

    // Check if post already exists
    const existing = await getHttpClient().query(api.posts.getPostByShortcode, {
      shortcode: post.shortcode,
    });

    // Extract username from oEmbed response or fallback to URL extraction
    const username = result.username ?? extractUsernameFromUrl(postUrl);

    if (!username) {
      return {
        success: false,
        error: "Could not determine username from URL",
      };
    }

    // Get or create/update user with to_be_scraped=false
    const user = await getHttpClient().query(api.users.getUserByUsername, {
      username,
    });

    // Always ensure user has to_be_scraped=false when saving single posts
    const userId = await getHttpClient().mutation(api.users.upsertUser, {
      id: user?._id,
      username,
      to_be_scraped: false, // Don't auto-scrape single posts
      last_scraped_at: user?.last_scraped_at,
    });

    // Save post to database
    // When updating existing posts, don't overwrite sent, sentAt, or event_date
    const postId = await getHttpClient().mutation(api.posts.upsertPost, {
      id: existing?._id,
      ig_id: post.id,
      shortcode: post.shortcode,
      display_url: post.display_url,
      video_url: post.video_url,
      thumbnail_url: post.thumbnail_url,
      caption: post.caption, // Caption is updated when re-scraping
      is_video: post.is_video,
      url: post.url,
      media_type: post.media_type,
      users: [userId],
      timestamp: post.timestampSec,
      // Don't pass event_date, sent, or sentAt when updating - they will be preserved
      // When creating new posts, these will default to undefined/false
      ...(existing?._id
        ? {}
        : { event_date: undefined, sent: false, sentAt: undefined }),
    });

    // Sync media items: updates existing, adds new, removes deleted ones
    // This ensures media items stay in sync with the scraped data
    await getHttpClient().mutation(api.media_items.syncMediaItemsForPost, {
      post_id: postId,
      media_items: post.media_items,
    });

    return {
      success: true,
      postId,
    };
  } catch (error) {
    logger.error(`Error in scrapeAndSaveSinglePost: ${error}`);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
