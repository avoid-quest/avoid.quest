import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import { Bot, GrammyError, InputMediaBuilder } from "grammy";
import { api, getHttpClient } from "../convex/client";
import { createLogger } from "../infra/logger";
import type { MediaItem } from "./types";
import { buildMediaGroup, validateAndFilterMediaItems, validateMediaGroup, validateMediaUrls } from "./media-handler";
import { createCaption, sanitizeHtmlForTelegram } from "./caption-builder";
import { handleTelegramApiError, logGrammyError } from "./error-handler";

type Logger = ReturnType<typeof createLogger>;

/**
 * Send a single post to Telegram with progressive fallback strategies
 */
export async function sendPost(
  bot: Bot,
  chatId: string,
  post: Doc<"posts">,
  logger: Logger
): Promise<void> {
  const caption = createCaption(post);

  // Load media items for this post
  const mediaItems = await getHttpClient().query(
    api.media_items.getMediaItemsByPostId,
    { postId: post._id }
  );

  // Convert to MediaItem format and filter valid types
  const mediaItemsWithThumbnail = mediaItems
    .filter((m) => m.type === "image" || m.type === "video" || m.type === "thumbnail")
    .map((m) => ({
      url: m.url,
      type: m.type as "image" | "video" | "thumbnail",
      width: m.width,
      height: m.height,
    }));

  // Validate and filter media items
  const validMedia = await validateAndFilterMediaItems(
    mediaItemsWithThumbnail,
    logger,
    !!process.env.DEBUG
  );

  logger.debug(
    `Sending post ${post._id} with ${validMedia.length} media items (total: ${mediaItems.length})`
  );

  try {
    // Strategy 1: Try media group if we have multiple items
    if (validMedia.length > 1) {
      // Validate media group before attempting to send
      const validation = validateMediaGroup(validMedia, caption);

      if (validation.warnings.length > 0) {
        logger.warn(`Media group warnings for post ${post._id}: ${validation.warnings.join(", ")}`);
      }

      if (!validation.isValid) {
        logger.error(`Media group validation failed for post ${post._id}:`);
        for (const error of validation.errors) {
          logger.error(`  - ${error}`);
        }
        logger.debug(`Media items: ${JSON.stringify(validMedia.map((m, idx) => ({ index: idx, type: m.type, url: m.url })))}`);
        // Fall through to try other strategies
      } else {
        // Check URL accessibility
        logger.debug(`Validating URL accessibility for ${validMedia.length} media items...`);
        const urlValidation = await validateMediaUrls(validMedia, logger);

        if (urlValidation.inaccessible.length > 0) {
          logger.error(`Inaccessible URLs detected for post ${post._id}:`);
          for (const item of urlValidation.inaccessible) {
            logger.error(`  - Item ${item.index} (${validMedia[item.index]?.type}): ${item.error} - ${item.url}`);
          }
          logger.warn(`Only ${urlValidation.accessible} of ${validMedia.length} URLs are accessible`);
        } else {
          logger.debug(`All ${validMedia.length} media URLs are accessible`);
        }

        // Try sending media group with fallback
        try {
          await sendMediaGroupWithFallback(bot, chatId, validMedia, caption, logger);
          return;
        } catch (error) {
          logger.warn(`Media group sending failed, trying fallback strategies: ${error instanceof Error ? error.message : String(error)}`);
          // Fall through to try other strategies
        }
      }
    }

    // Strategy 2: Try primary media URLs from post
    if (await tryPrimaryMedia(bot, chatId, post, caption, logger)) {
      return;
    }

    // Strategy 3: Try single valid media item
    if (validMedia.length === 1) {
      const media = validMedia[0];
      if (media) {
        await sendSingleMedia(bot, chatId, media, caption, logger);
        return;
      }
    }

    // Strategy 4: Fallback to text-only message
    logger.debug(`No valid media found, sending text-only message for post ${post._id}`);
    await bot.api.sendMessage(chatId, caption, { parse_mode: "HTML" });
  } catch (error) {
    if (error instanceof GrammyError) {
      handleTelegramApiError(error, logger, `Failed to send post ${post._id}`);
      logger.debug(
        `Post details: ${JSON.stringify({
          postId: post._id,
          mediaType: post.media_type,
          mediaCount: validMedia.length,
          hasVideoUrl: !!post.video_url,
          hasDisplayUrl: !!post.display_url,
        })}`
      );
    }
    throw error;
  }
}

/**
 * Send media group with fallback to single media if group fails
 */
async function sendMediaGroupWithFallback(
  bot: Bot,
  chatId: string,
  media: MediaItem[],
  caption: string,
  logger: Logger
): Promise<void> {
  try {
    logger.debug(`Attempting to send media group with ${media.length} items`);
    logger.debug(
      `Media URLs: ${media.map((m, idx) => `${idx}:${m.type}:${m.url.substring(0, 50)}...`).join(", ")}`
    );

    // Log media group composition for debugging
    const videoCount = media.filter((m) => m.type === "video").length;
    const imageCount = media.filter((m) => m.type === "image").length;
    logger.debug(`Media group composition: ${videoCount} video(s), ${imageCount} image(s)`);
    logger.debug(`Caption length: ${caption.length} characters`);

    const mediaGroup = buildMediaGroup(media, caption);
    await bot.api.sendMediaGroup(chatId, mediaGroup);
    logger.debug(`Successfully sent media group with ${media.length} items`);
  } catch (error) {
    if (error instanceof GrammyError) {
      logGrammyError(logger, error, `Failed to send media group (${media.length} items)`);

      // Enhanced error logging with full media details
      logger.error(`Full media group details:`);
      for (let i = 0; i < media.length; i++) {
        const item = media[i];
        if (item) {
          logger.error(`  Item ${i}: type=${item.type}, url=${item.url}`);
        }
      }

      handleTelegramApiError(error, logger, `Media group send failed`);
    }

    // Fallback: send single best media item
    logger.warn(`Media group failed, falling back to single best media item`);
    await sendSingleBestMediaItem(bot, chatId, media, caption, logger);
  }
}

/**
 * Send single best media item (prefer images, higher resolution)
 */
async function sendSingleBestMediaItem(
  bot: Bot,
  chatId: string,
  media: MediaItem[],
  caption: string,
  logger: Logger
): Promise<void> {
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

  logger.debug(
    `Selected best media item: ${bestItem.type} - ${bestItem.url}`
  );

  // Sanitize caption to prevent HTML parsing errors
  const sanitizedCaption = caption
    ? sanitizeHtmlForTelegram(caption)
    : undefined;

  await sendSingleMedia(bot, chatId, bestItem, sanitizedCaption || caption, logger);
}

/**
 * Send single media item (photo or video)
 */
export async function sendSingleMedia(
  bot: Bot,
  chatId: string,
  media: MediaItem,
  caption: string,
  logger: Logger
): Promise<void> {
  const sanitizedCaption = caption ? sanitizeHtmlForTelegram(caption) : undefined;

  if (media.type === "video") {
    await bot.api.sendVideo(chatId, media.url, {
      caption: sanitizedCaption,
      parse_mode: "HTML",
    });
  } else {
    await bot.api.sendPhoto(chatId, media.url, {
      caption: sanitizedCaption,
      parse_mode: "HTML",
    });
  }
}

/**
 * Try sending using post's primary media URLs
 */
async function tryPrimaryMedia(
  bot: Bot,
  chatId: string,
  post: Doc<"posts">,
  caption: string,
  logger: Logger
): Promise<boolean> {
  const sanitizedCaption = sanitizeHtmlForTelegram(caption);

  if (post.media_type === "video" && post.video_url) {
    logger.debug(`Trying primary video URL: ${post.video_url}`);
    try {
      await bot.api.sendVideo(chatId, post.video_url, {
        caption: sanitizedCaption,
        parse_mode: "HTML",
        thumbnail: post.thumbnail_url,
      });
      return true;
    } catch (error) {
      logger.warn(`Primary video URL failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  if (post.media_type === "image" && post.display_url) {
    logger.debug(`Trying primary image URL: ${post.display_url}`);
    try {
      await bot.api.sendPhoto(chatId, post.display_url, {
        caption: sanitizedCaption,
        parse_mode: "HTML",
      });
      return true;
    } catch (error) {
      logger.warn(`Primary image URL failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  return false;
}

