import { now } from "@avoid.quest/shared";
import {
  createMediaUploadService,
  type MediaUploadService,
  type UploadResult,
} from "@avoid.quest/telegram/media";
import type { Doc, Id } from "@workspace/backend/convex/_generated/dataModel";
import { sleep } from "bun";
import { api, getHttpClient } from "../convex/client";
import { createLogger } from "../infra/logger";
import { TokenBucketLimiter } from "../infra/rate-limiter";
import { getEffectiveSettings } from "../settings";
import { createBot } from "../telegram/bot";
import { InstagramAdapter, type SinglePostResponse } from "./instagram";

type MediaItemLike = Omit<Doc<"media_items">, "_id" | "_creationTime">;
type PostLike = Omit<Doc<"posts">, "_id" | "_creationTime">;

/**
 * Upload context for media during fetch
 */
type UploadContext = {
  uploader: MediaUploadService;
  chatId: string;
} | null;

export async function loadUsersToBeFetched(
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

/**
 * Optionally trigger metadata extraction for a newly created post
 * Only triggers if AI metadata extraction is enabled in settings
 * Errors are logged but don't fail the fetching process
 */
async function optionallyTriggerMetadataExtraction(
  postId: Id<"posts">,
  isNewPost: boolean,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  // Only trigger for new posts, not updates
  if (!isNewPost) {
    return;
  }

  try {
    // Check if AI metadata extraction is enabled
    const settings = await getHttpClient().query(api.settings.getSettings, {});
    const aiSettings = settings?.ai_metadata_extraction;

    if (!aiSettings?.active) {
      logger.debug(
        `Skipping immediate metadata extraction for post ${postId} (AI extraction disabled)`
      );
      return;
    }

    // Trigger metadata extraction workflow
    // This is fire-and-forget - errors are handled by the workflow's onComplete handler
    logger.debug(`Triggering immediate metadata extraction for post ${postId}`);
    await getHttpClient().action(
      api.workflows.postMetadata.triggerMetadataExtraction,
      {
        postId,
      }
    );
    logger.debug(`Metadata extraction workflow triggered for post ${postId}`);
  } catch (error) {
    // Log error but don't fail fetching - metadata will be processed by cron job
    logger.warn(
      `Failed to trigger immediate metadata extraction for post ${postId}: ${
        error instanceof Error ? error.message : String(error)
      }. Will be processed by cron job.`
    );
  }
}

/**
 * Upload media items to Telegram and return the upload results
 */
async function uploadMediaToTelegram(
  mediaItems: Array<{
    url: string;
    type: "image" | "video" | "thumbnail";
    width?: number;
    height?: number;
  }>,
  uploadContext: UploadContext,
  logger: ReturnType<typeof createLogger>
): Promise<UploadResult[]> {
  if (!uploadContext) {
    return [];
  }

  const { uploader, chatId } = uploadContext;
  const uploadResults: UploadResult[] = [];
  const UPLOAD_DELAY_MS = 500;

  // Filter out thumbnails - we only upload images and videos
  const uploadableMedia = mediaItems.filter(
    (m) => m.type === "image" || m.type === "video"
  );

  for (const [index, item] of uploadableMedia.entries()) {
    try {
      logger.debug(
        `Uploading ${item.type} ${index + 1}/${uploadableMedia.length}...`
      );

      let result: UploadResult;
      if (item.type === "video") {
        result = await uploader.uploadVideo(chatId, item.url);
      } else {
        result = await uploader.uploadPhoto(chatId, item.url);
      }

      uploadResults.push(result);

      // Add delay between uploads to respect rate limits (except after last item)
      if (index < uploadableMedia.length - 1) {
        await sleep(UPLOAD_DELAY_MS);
      }
    } catch (error) {
      logger.warn(
        `Failed to upload media item: ${error instanceof Error ? error.message : String(error)}`
      );
      // Continue with other items even if one fails
    }
  }

  return uploadResults;
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
  userId: Id<"users">,
  logger: ReturnType<typeof createLogger>,
  uploadContext: UploadContext
): Promise<void> {
  const existing = await getHttpClient().query(api.posts.getPostByShortcode, {
    shortcode: post.shortcode,
  });

  const isNewPost = !existing?._id;

  // For new posts, upload media to Telegram FIRST while Instagram URLs are still fresh
  let telegramMedia: UploadResult[] = [];
  if (isNewPost && uploadContext) {
    logger.debug(`Uploading media to Telegram for new post ${post.shortcode}`);
    telegramMedia = await uploadMediaToTelegram(
      post.media_items,
      uploadContext,
      logger
    );
    logger.debug(
      `Uploaded ${telegramMedia.length}/${post.media_items.filter((m) => m.type !== "thumbnail").length} media items to Telegram`
    );
  }

  // When updating existing posts, don't overwrite sent, sentAt, or event_date
  // Only pass these fields when creating new posts
  const postId = await getHttpClient().mutation(api.posts.upsertPost, {
    id: existing?._id,
    ig_id: post.id,
    shortcode: post.shortcode,
    display_url: post.display_url,
    video_url: post.video_url,
    thumbnail_url: post.thumbnail_url,
    caption: post.caption, // Caption is updated when re-fetching
    is_video: post.is_video,
    url: post.url,
    media_type: post.media_type,
    users: [userId],
    timestamp: post.timestampSec,
    // Don't pass event_date, sent, or sentAt when updating - they will be preserved
    // When creating new posts, these will default to undefined/false
    ...(isNewPost
      ? { event_date: undefined, sent: false, sentAt: undefined }
      : {}),
  });

  // Sync media items based on what we have
  if (telegramMedia.length > 0) {
    // Use Telegram file_ids for new posts that were successfully uploaded
    await getHttpClient().mutation(
      api.media_items.syncTelegramMediaItemsForPost,
      {
        post_id: postId,
        media_items: telegramMedia.map((m) => ({
          file_id: m.file_id,
          file_unique_id: m.file_unique_id,
          type: m.type,
          width: m.width,
          height: m.height,
        })),
      }
    );
  } else {
    // Fallback: sync with Instagram URLs (for existing posts or when upload fails)
    await getHttpClient().mutation(api.media_items.syncMediaItemsForPost, {
      post_id: postId,
      media_items: post.media_items,
    });
  }

  // Optionally trigger immediate metadata extraction for new posts
  // This is rate-limit aware and respects settings
  await optionallyTriggerMetadataExtraction(postId, isNewPost, logger);
}

async function processUser(
  user: Doc<"users">,
  opts: {
    postsPerUser: number;
    minIntervalMs: number;
    adapter: InstagramAdapter;
    logger: ReturnType<typeof createLogger>;
    msPerMinute: number;
    uploadContext: UploadContext;
  }
): Promise<boolean> {
  const {
    postsPerUser,
    minIntervalMs,
    adapter,
    logger,
    msPerMinute,
    uploadContext,
  } = opts;
  if (!user.username) {
    return false;
  }

  const last = user.last_scraped_at ?? 0;
  const currentTime = now();
  if (last > 0 && currentTime - last < minIntervalMs) {
    const minutesAgo = Math.round((currentTime - last) / msPerMinute);
    logger.debug(`Skip @${user.username} (fetched ${minutesAgo}m ago)`);
    return false;
  }

  logger.info(`Fetching @${user.username}`);
  const posts = await adapter.getRecent(user.username, postsPerUser);
  logger.debug(`Fetched ${posts.length} posts for @${user.username}`);

  const cvxUser = await getHttpClient().query(api.users.getUserByUsername, {
    username: user.username,
  });
  if (!cvxUser) {
    logger.warn(`User @${user.username} not found in database`);
    return false;
  }

  for (const p of posts) {
    await processPost(p, cvxUser._id, logger, uploadContext);
  }

  await updateUserLastScraped(user._id, now());
  logger.debug(`Updated last_scraped_at for @${user.username}`);
  return true;
}

export async function fetchOnce(): Promise<void> {
  const settings = await getEffectiveSettings();
  if (!settings.instagram.active) {
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

  const usersPerSession = settings.instagram.limit ?? DEFAULT_USERS_PER_SESSION;
  const postsPerUser =
    settings.instagram.post_per_user ?? DEFAULT_POSTS_PER_USER;
  const minIntervalMs = DEFAULT_MIN_INTERVAL_MINUTES * MS_PER_MINUTE;

  const users = await loadUsersToBeFetched();
  const logger = createLogger(
    !!(settings.logging?.active || process.env.DEBUG),
    process.env.DEBUG ? "debug" : "info"
  );
  const limiter = new TokenBucketLimiter(DEFAULT_BURST, DEFAULT_RPS);
  const adapter = new InstagramAdapter(
    {
      minDelayMs: 2000,
      maxDelayMs: 5000,
      timeoutMs: 30_000,
      postProcessingDelayMs: 2000,
      postProcessingMaxDelayMs: 5000,
    },
    { limiter, logger }
  );

  // Initialize upload context for Telegram media uploads
  let uploadContext: UploadContext = null;
  const chatId =
    settings.telegram.group_chat_id || settings.telegram.admin_chat_id;

  if (settings.telegram.active && chatId) {
    const bot = createBot();
    if (bot) {
      uploadContext = {
        uploader: createMediaUploadService(bot.api, {
          deleteAfterUpload: true, // Delete temporary upload messages
          logger,
        }),
        chatId,
      };
      logger.info("Telegram media upload enabled during fetch");
    } else {
      logger.warn(
        "TELEGRAM_BOT_TOKEN not set, media will be stored with Instagram URLs (may expire)"
      );
    }
  } else {
    logger.debug(
      "Telegram not active or no chat ID configured, media will be stored with Instagram URLs"
    );
  }

  logger.info(
    `Fetching up to ${usersPerSession} users (${postsPerUser} posts per user) from ${users.length} candidates`
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
      skippedNoUsername += 1;
      continue;
    }

    const wasProcessed = await processUser(user, {
      postsPerUser,
      minIntervalMs,
      adapter,
      logger,
      msPerMinute: MS_PER_MINUTE,
      uploadContext,
    });

    if (wasProcessed) {
      processedUsers += 1;
    } else {
      skippedRecently += 1;
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
    `Fetch finished. Processed: ${processedUsers}, Skipped: ${skippedNoUsername} no username, ${skippedRecently} recently fetched`
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

export async function fetchAndSaveSinglePost(
  postUrl: string
): Promise<{ success: boolean; postId?: string; error?: string }> {
  const settings = await getEffectiveSettings();
  const logger = createLogger(
    !!(settings.logging?.active || process.env.DEBUG),
    process.env.DEBUG ? "debug" : "info"
  );

  try {
    // Initialize adapter
    const DEFAULT_BURST = 3;
    const DEFAULT_RPS = 0.5;
    const limiter = new TokenBucketLimiter(DEFAULT_BURST, DEFAULT_RPS);
    const adapter = new InstagramAdapter(
      {
        minDelayMs: 2000,
        maxDelayMs: 5000,
        timeoutMs: 30_000,
        postProcessingDelayMs: 2000,
        postProcessingMaxDelayMs: 5000,
      },
      { limiter, logger }
    );

    // Initialize upload context for Telegram media uploads
    let uploadContext: UploadContext = null;
    const chatId =
      settings.telegram.group_chat_id || settings.telegram.admin_chat_id;

    if (settings.telegram.active && chatId) {
      const bot = createBot();
      if (bot) {
        uploadContext = {
          uploader: createMediaUploadService(bot.api, {
            deleteAfterUpload: true,
            logger,
          }),
          chatId,
        };
      }
    }

    // Fetch the post
    const result: SinglePostResponse = await adapter.getSinglePost(postUrl);

    if (!result.success) {
      return {
        success: false,
        error: result.error ?? "Failed to fetch post",
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

    const isNewPost = !existing?._id;

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

    // For new posts, upload media to Telegram FIRST while Instagram URLs are still fresh
    let telegramMedia: UploadResult[] = [];
    if (isNewPost && uploadContext) {
      logger.debug(
        `Uploading media to Telegram for new post ${post.shortcode}`
      );
      telegramMedia = await uploadMediaToTelegram(
        post.media_items,
        uploadContext,
        logger
      );
      logger.debug(
        `Uploaded ${telegramMedia.length}/${post.media_items.filter((m) => m.type !== "thumbnail").length} media items to Telegram`
      );
    }

    // Save post to database
    // When updating existing posts, don't overwrite sent, sentAt, or event_date
    const postId = await getHttpClient().mutation(api.posts.upsertPost, {
      id: existing?._id,
      ig_id: post.id,
      shortcode: post.shortcode,
      display_url: post.display_url,
      video_url: post.video_url,
      thumbnail_url: post.thumbnail_url,
      caption: post.caption, // Caption is updated when re-fetching
      is_video: post.is_video,
      url: post.url,
      media_type: post.media_type,
      users: [userId],
      timestamp: post.timestampSec,
      // Don't pass event_date, sent, or sentAt when updating - they will be preserved
      // When creating new posts, these will default to undefined/false
      ...(isNewPost
        ? { event_date: undefined, sent: false, sentAt: undefined }
        : {}),
    });

    // Sync media items based on what we have
    if (telegramMedia.length > 0) {
      // Use Telegram file_ids for new posts that were successfully uploaded
      await getHttpClient().mutation(
        api.media_items.syncTelegramMediaItemsForPost,
        {
          post_id: postId,
          media_items: telegramMedia.map((m) => ({
            file_id: m.file_id,
            file_unique_id: m.file_unique_id,
            type: m.type,
            width: m.width,
            height: m.height,
          })),
        }
      );
    } else {
      // Fallback: sync with Instagram URLs (for existing posts or when upload fails)
      await getHttpClient().mutation(api.media_items.syncMediaItemsForPost, {
        post_id: postId,
        media_items: post.media_items,
      });
    }

    // Optionally trigger immediate metadata extraction for new posts
    // This is rate-limit aware and respects settings
    await optionallyTriggerMetadataExtraction(postId, isNewPost, logger);

    return {
      success: true,
      postId,
    };
  } catch (error) {
    logger.error(
      `Error in fetchAndSaveSinglePost: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
