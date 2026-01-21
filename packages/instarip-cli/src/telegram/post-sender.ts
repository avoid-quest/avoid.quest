import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import { type Bot, GrammyError } from "grammy";
import { api, getHttpClient } from "../convex/client";
import type { createLogger } from "../infra/logger";
import { createCaption } from "./caption-builder";
import { handleTelegramApiError, logGrammyError } from "./error-handler";
import {
  buildMediaGroup,
  validateAndFilterMediaItems,
  validateMediaGroup,
  validateMediaUrls,
} from "./media-handler";
import type { MediaItem, MediaItemWithThumbnail } from "./types";

type Logger = ReturnType<typeof createLogger>;

/**
 * Refresh post to get latest metadata_id
 */
async function refreshPost(
  post: Doc<"posts">,
  logger: Logger
): Promise<Doc<"posts">> {
  try {
    const refreshedPost = await getHttpClient().query(api.posts.getPostById, {
      id: post._id,
    });
    if (refreshedPost) {
      logger.debug(
        `Refreshed post ${post._id}, metadata_id: ${refreshedPost.metadata_id || "none"}`
      );
      return refreshedPost;
    }
  } catch (error) {
    logger.debug(
      `Failed to refresh post ${post._id}, using original: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return post;
}

/**
 * Fetch post metadata if available
 */
async function fetchPostMetadata(
  post: Doc<"posts">,
  logger: Logger
): Promise<Doc<"post_metadata"> | null> {
  if (!post.metadata_id) {
    logger.info(`Post ${post._id} has no metadata_id, using raw caption`);
    return null;
  }

  try {
    const metadata = await getHttpClient().query(
      api.post_metadata.getPostMetadata,
      {
        postId: post._id,
      }
    );
    if (metadata) {
      logger.debug(
        `Fetched metadata for post ${post._id}, has telegram_message: ${!!metadata.telegram_message}`
      );
      if (metadata.telegram_message) {
        logger.info(
          `✅ Using AI-generated telegram message for post ${post._id} (length: ${metadata.telegram_message.length})`
        );
      } else {
        logger.info(
          `⚠️  Metadata exists for post ${post._id} but no telegram_message found (event_score: ${metadata.event_score})`
        );
      }
      return metadata;
    }
  } catch (error) {
    logger.warn(
      `Failed to fetch metadata for post ${post._id}, using raw caption: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return null;
}

/**
 * Prepare caption and log details
 */
function prepareCaption(
  post: Doc<"posts">,
  metadata: Doc<"post_metadata"> | null,
  logger: Logger
): string {
  const caption = createCaption(post, metadata);

  const captionSource = metadata?.telegram_message
    ? "AI-generated"
    : "raw caption";
  logger.info(
    `Caption for post ${post._id}: ${captionSource}, length: ${caption.length}`
  );

  if (metadata?.telegram_message && caption !== metadata.telegram_message) {
    logger.warn(
      `⚠️  Caption mismatch! Expected AI-generated message but got different caption for post ${post._id}`
    );
  }

  return caption;
}

/**
 * Load and validate media items for post
 */
async function loadAndValidateMedia(
  post: Doc<"posts">,
  logger: Logger
): Promise<MediaItem[]> {
  const mediaItems = await getHttpClient().query(
    api.media_items.getMediaItemsByPostId,
    { postId: post._id }
  );

  const mediaItemsWithThumbnail = mediaItems
    .filter(
      (m) => m.type === "image" || m.type === "video" || m.type === "thumbnail"
    )
    .map((m) => ({
      url: m.url,
      type: m.type as
        | "image"
        | "video"
        | "thumbnail" as MediaItemWithThumbnail["type"],
      width: m.width,
      height: m.height,
    }));

  const validMedia = validateAndFilterMediaItems(
    mediaItemsWithThumbnail,
    logger,
    !!process.env.DEBUG
  );

  logger.debug(
    `Sending post ${post._id} with ${validMedia.length} media items (total: ${mediaItems.length})`
  );

  return validMedia;
}

type ExecuteSendStrategiesOptions = {
  bot: Bot;
  chatId: string;
  post: Doc<"posts">;
  validMedia: MediaItem[];
  caption: string;
  logger: Logger;
};

/**
 * Try media group strategy
 */
async function tryMediaGroupStrategyWithFallback(
  options: ExecuteSendStrategiesOptions
): Promise<boolean> {
  const { bot, chatId, validMedia, caption, logger, post } = options;
  try {
    if (
      await tryMediaGroupStrategy({
        bot,
        chatId,
        validMedia,
        caption,
        logger,
        postId: post._id,
      })
    ) {
      return true;
    }
  } catch (error) {
    logger.warn(
      `Media group strategy failed, trying next strategy: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return false;
}

/**
 * Try primary media strategy
 */
async function tryPrimaryMediaStrategyWithFallback(
  options: ExecuteSendStrategiesOptions
): Promise<boolean> {
  const { bot, chatId, post, caption, logger } = options;
  try {
    if (
      await tryPrimaryMedia({
        bot,
        chatId,
        post,
        caption,
        logger,
      })
    ) {
      return true;
    }
  } catch (error) {
    logger.warn(
      `Primary media strategy failed, trying next strategy: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return false;
}

/**
 * Try single media item strategy
 */
async function trySingleMediaStrategyWithFallback(
  options: ExecuteSendStrategiesOptions
): Promise<boolean> {
  const { bot, chatId, validMedia, caption, logger } = options;
  if (validMedia.length !== 1) {
    return false;
  }

  const media = validMedia[0];
  if (!media) {
    return false;
  }

  try {
    await sendSingleMedia({ bot, chatId, media, caption, logger });
    return true;
  } catch (error) {
    logger.warn(
      `Single media item failed, falling back to text-only: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

/**
 * Execute sending strategies with fallback
 */
async function executeSendStrategies(
  options: ExecuteSendStrategiesOptions
): Promise<void> {
  const { bot, chatId, post, caption, logger } = options;

  if (await tryMediaGroupStrategyWithFallback(options)) {
    return;
  }

  if (await tryPrimaryMediaStrategyWithFallback(options)) {
    return;
  }

  if (await trySingleMediaStrategyWithFallback(options)) {
    return;
  }

  // Strategy 4: Fallback to text-only message
  logger.info(
    `All media strategies failed or no valid media found, sending text-only message for post ${post._id}`
  );
  await bot.api.sendMessage(chatId, caption, { parse_mode: "HTML" });
}

/**
 * Send a single post to Telegram with progressive fallback strategies
 */
export async function sendPost(
  bot: Bot,
  chatId: string,
  post: Doc<"posts">,
  logger: Logger
): Promise<void> {
  const currentPost = await refreshPost(post, logger);
  const metadata = await fetchPostMetadata(currentPost, logger);
  const caption = prepareCaption(currentPost, metadata, logger);
  const validMedia = await loadAndValidateMedia(currentPost, logger);

  try {
    await executeSendStrategies({
      bot,
      chatId,
      post: currentPost,
      validMedia,
      caption,
      logger,
    });
  } catch (error) {
    if (error instanceof GrammyError) {
      handleTelegramApiError(
        error,
        logger,
        `Failed to send post ${currentPost._id}`
      );
      logger.debug(
        `Post details: ${JSON.stringify({
          postId: currentPost._id,
          mediaType: currentPost.media_type,
          mediaCount: validMedia.length,
          hasVideoUrl: !!currentPost.video_url,
          hasDisplayUrl: !!currentPost.display_url,
        })}`
      );
    }
    throw error;
  }
}

type TryMediaGroupStrategyOptions = {
  bot: Bot;
  chatId: string;
  validMedia: MediaItem[];
  caption: string;
  logger: Logger;
  postId: string;
};

async function tryMediaGroupStrategy(
  options: TryMediaGroupStrategyOptions
): Promise<boolean> {
  const { bot, chatId, validMedia, caption, logger, postId } = options;

  if (validMedia.length <= 1) {
    return false;
  }

  // Validate media group before attempting to send
  const validation = validateMediaGroup(validMedia, caption);

  if (validation.warnings.length > 0) {
    logger.warn(
      `Media group warnings for post ${postId}: ${validation.warnings.join(", ")}`
    );
  }

  if (!validation.isValid) {
    logger.error(`Media group validation failed for post ${postId}:`);
    for (const error of validation.errors) {
      logger.error(`  - ${error}`);
    }
    logger.debug(
      `Media items: ${JSON.stringify(validMedia.map((m, idx) => ({ index: idx, type: m.type, url: m.url })))}`
    );
    return false;
  }

  // Check URL accessibility
  logger.debug(
    `Validating URL accessibility for ${validMedia.length} media items...`
  );
  const urlValidation = await validateMediaUrls(validMedia, logger);

  if (urlValidation.inaccessible.length > 0) {
    logger.error(`Inaccessible URLs detected for post ${postId}:`);
    for (const item of urlValidation.inaccessible) {
      logger.error(
        `  - Item ${item.index} (${validMedia[item.index]?.type}): ${item.error} - ${item.url}`
      );
    }
    logger.warn(
      `Only ${urlValidation.accessible} of ${validMedia.length} URLs are accessible`
    );
  } else {
    logger.debug(`All ${validMedia.length} media URLs are accessible`);
  }

  // Try sending media group with fallback
  try {
    await sendMediaGroupWithFallback({
      bot,
      chatId,
      media: validMedia,
      caption,
      logger,
    });
    return true;
  } catch (error) {
    logger.warn(
      `Media group sending failed, trying fallback strategies: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

type SendMediaOptions = {
  bot: Bot;
  chatId: string;
  media: MediaItem[];
  caption: string;
  logger: Logger;
};

/**
 * Send media group with fallback to single media if group fails
 */
async function sendMediaGroupWithFallback(
  options: SendMediaOptions
): Promise<void> {
  const { bot, chatId, media, caption, logger } = options;
  try {
    logger.debug(`Attempting to send media group with ${media.length} items`);
    const MAX_URL_PREVIEW_LENGTH = 50;
    logger.debug(
      `Media URLs: ${media.map((m, idx) => `${idx}:${m.type}:${m.url.substring(0, MAX_URL_PREVIEW_LENGTH)}...`).join(", ")}`
    );

    // Log media group composition for debugging
    const videoCount = media.filter((m) => m.type === "video").length;
    const imageCount = media.filter((m) => m.type === "image").length;
    logger.debug(
      `Media group composition: ${videoCount} video(s), ${imageCount} image(s)`
    );
    logger.debug(`Caption length: ${caption.length} characters`);

    const mediaGroup = buildMediaGroup(media, caption);
    await bot.api.sendMediaGroup(chatId, mediaGroup);
    logger.debug(`Successfully sent media group with ${media.length} items`);
  } catch (error) {
    if (error instanceof GrammyError) {
      logGrammyError(
        logger,
        error,
        `Failed to send media group (${media.length} items)`
      );

      // Enhanced error logging with full media details
      logger.error("Full media group details:");
      for (let i = 0; i < media.length; i++) {
        const item = media[i];
        if (item) {
          logger.error(`  Item ${i}: type=${item.type}, url=${item.url}`);
        }
      }

      handleTelegramApiError(error, logger, "Media group send failed");
    }

    // Fallback: send single best media item
    logger.warn("Media group failed, falling back to single best media item");
    await sendSingleBestMediaItem({ bot, chatId, media, caption, logger });
  }
}

/**
 * Send single best media item (prefer images, higher resolution)
 */
async function sendSingleBestMediaItem(
  options: SendMediaOptions
): Promise<void> {
  const { bot, chatId, media, caption, logger } = options;
  // Prefer images over videos, and prefer higher resolution
  const bestItem =
    media
      .filter((item) => item.type === "image") // Prefer images
      .sort((a, b) => {
        // Sort by resolution (width * height), higher first
        const aRes = (a.width || 0) * (a.height || 0);
        const bRes = (b.width || 0) * (b.height || 0);
        return bRes - aRes;
      })[0] || media[0]; // Fallback to first item if no images

  if (!bestItem) {
    throw new Error("No valid media item found");
  }

  logger.debug(`Selected best media item: ${bestItem.type} - ${bestItem.url}`);

  try {
    await sendSingleMedia({
      bot,
      chatId,
      media: bestItem,
      caption,
      logger,
    });
  } catch (error) {
    // If media fails, throw error to trigger text-only fallback
    logger.warn(
      `Best media item failed, will fallback to text-only: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

type SendSingleMediaOptions = {
  bot: Bot;
  chatId: string;
  media: MediaItem;
  caption: string;
  logger: Logger;
};

/**
 * Send single media item (photo or video)
 */
export async function sendSingleMedia(
  options: SendSingleMediaOptions
): Promise<void> {
  const { bot, chatId, media, caption, logger } = options;

  try {
    if (media.type === "video") {
      await bot.api.sendVideo(chatId, media.url, {
        caption,
        parse_mode: "HTML",
      });
    } else {
      await bot.api.sendPhoto(chatId, media.url, {
        caption,
        parse_mode: "HTML",
      });
    }
  } catch (error) {
    // Check if it's a media-related error (expired URL, wrong content type, etc.)
    if (error instanceof GrammyError) {
      const isMediaError =
        error.error_code === 400 &&
        (error.description?.includes("wrong type") ||
          error.description?.includes("Bad Request") ||
          error.description?.includes("file") ||
          error.description?.includes("web page content"));

      if (isMediaError) {
        logger.warn(
          `Media URL failed (likely expired or invalid): ${error.description} - ${media.url.substring(0, 100)}...`
        );
        // Re-throw as a specific error that can be caught for fallback
        throw new Error(`Media URL expired or invalid: ${error.description}`);
      }
    }
    // Re-throw other errors
    throw error;
  }
}

type TryPrimaryMediaOptions = {
  bot: Bot;
  chatId: string;
  post: Doc<"posts">;
  caption: string;
  logger: Logger;
};

type TrySendVideoOptions = {
  bot: Bot;
  chatId: string;
  videoUrl: string;
  caption: string;
  thumbnailUrl: string | undefined;
  logger: Logger;
};

async function trySendVideo(options: TrySendVideoOptions): Promise<boolean> {
  const { bot, chatId, videoUrl, caption, thumbnailUrl, logger } = options;
  logger.debug(`Trying primary video URL: ${videoUrl}`);
  try {
    const videoOptions: Parameters<typeof bot.api.sendVideo>[2] = {
      caption,
      parse_mode: "HTML",
    };
    if (thumbnailUrl) {
      // Grammy accepts string URLs for thumbnails, but TypeScript types are strict
      (videoOptions as { thumbnail?: string }).thumbnail = thumbnailUrl;
    }
    await bot.api.sendVideo(chatId, videoUrl, videoOptions);
    return true;
  } catch (error) {
    // Check if it's a media-related error (expired URL, wrong content type, etc.)
    if (error instanceof GrammyError) {
      const isMediaError =
        error.error_code === 400 &&
        (error.description?.includes("wrong type") ||
          error.description?.includes("Bad Request") ||
          error.description?.includes("file"));

      if (isMediaError) {
        logger.warn(
          `Primary video URL failed (likely expired or invalid): ${error.description}`
        );
      } else {
        logger.warn(
          `Primary video URL failed: ${error.description || error.message}`
        );
      }
    } else {
      logger.warn(
        `Primary video URL failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return false;
  }
}

type TrySendImageOptions = {
  bot: Bot;
  chatId: string;
  imageUrl: string;
  caption: string;
  logger: Logger;
};

async function trySendImage(options: TrySendImageOptions): Promise<boolean> {
  const { bot, chatId, imageUrl, caption, logger } = options;
  logger.debug(`Trying primary image URL: ${imageUrl}`);
  try {
    await bot.api.sendPhoto(chatId, imageUrl, {
      caption,
      parse_mode: "HTML",
    });
    return true;
  } catch (error) {
    // Check if it's a media-related error (expired URL, wrong content type, etc.)
    if (error instanceof GrammyError) {
      const isMediaError =
        error.error_code === 400 &&
        (error.description?.includes("wrong type") ||
          error.description?.includes("Bad Request") ||
          error.description?.includes("file") ||
          error.description?.includes("web page content"));

      if (isMediaError) {
        logger.warn(
          `Primary image URL failed (likely expired or invalid): ${error.description}`
        );
      } else {
        logger.warn(
          `Primary image URL failed: ${error.description || error.message}`
        );
      }
    } else {
      logger.warn(
        `Primary image URL failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return false;
  }
}

/**
 * Try sending using post's primary media URLs
 */
async function tryPrimaryMedia(
  options: TryPrimaryMediaOptions
): Promise<boolean> {
  const { bot, chatId, post, caption, logger } = options;

  if (post.media_type === "video" && post.video_url) {
    return await trySendVideo({
      bot,
      chatId,
      videoUrl: post.video_url,
      caption,
      thumbnailUrl: post.thumbnail_url,
      logger,
    });
  }

  if (post.media_type === "image" && post.display_url) {
    return await trySendImage({
      bot,
      chatId,
      imageUrl: post.display_url,
      caption,
      logger,
    });
  }

  return false;
}
