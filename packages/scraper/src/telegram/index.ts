import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, GrammyError, HttpError, InputMediaBuilder } from "grammy";
import { api, getHttpClient } from "../convex/client";
import { createLogger } from "../infra/logger";
import { getEffectiveSettings } from "../settings";

const DEFAULT_SEND_LIMIT = 3;

// Telegram API constraints
const MAX_MEDIA_GROUP_SIZE = 10;
const MIN_MEDIA_GROUP_SIZE = 2;
const MAX_CAPTION_LENGTH = 1024;

interface MediaValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

function validateMediaGroup(
  media: Array<{ url: string; type: "image" | "video" }>,
  caption: string
): MediaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check media count
  if (media.length < MIN_MEDIA_GROUP_SIZE) {
    errors.push(`Media group must have at least ${MIN_MEDIA_GROUP_SIZE} items, got ${media.length}`);
  }
  if (media.length > MAX_MEDIA_GROUP_SIZE) {
    errors.push(`Media group exceeds maximum of ${MAX_MEDIA_GROUP_SIZE} items, got ${media.length}`);
  }

  // Validate URLs
  for (let i = 0; i < media.length; i++) {
    const item = media[i];
    if (!item) {
      errors.push(`Media item at index ${i} is null or undefined`);
      continue;
    }

    if (!item.url || typeof item.url !== "string") {
      errors.push(`Media item at index ${i} has invalid URL: ${item.url}`);
      continue;
    }

    // Check URL format
    try {
      const url = new URL(item.url);
      if (!["http:", "https:"].includes(url.protocol)) {
        errors.push(`Media item at index ${i} has invalid protocol: ${url.protocol}`);
      }
    } catch {
      errors.push(`Media item at index ${i} has malformed URL: ${item.url}`);
    }

    // Validate media type
    if (item.type !== "image" && item.type !== "video") {
      errors.push(`Media item at index ${i} has invalid type: ${item.type}`);
    }
  }

  // Validate caption length
  if (caption.length > MAX_CAPTION_LENGTH) {
    errors.push(`Caption exceeds maximum length of ${MAX_CAPTION_LENGTH} characters, got ${caption.length}`);
  }

  // Check for mixed media types (Telegram may have issues with certain combinations)
  const hasVideos = media.some((m) => m.type === "video");
  const hasImages = media.some((m) => m.type === "image");
  if (hasVideos && hasImages) {
    warnings.push("Media group contains both videos and images - this may cause issues with some Telegram clients");
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

async function validateMediaUrls(
  media: Array<{ url: string; type: "image" | "video" }>,
  logger: ReturnType<typeof createLogger>
): Promise<{ accessible: number; inaccessible: Array<{ index: number; url: string; error: string }> }> {
  const inaccessible: Array<{ index: number; url: string; error: string }> = [];
  let accessible = 0;

  for (let i = 0; i < media.length; i++) {
    const item = media[i];
    if (!item) {
      continue;
    }

    try {
      // Quick HEAD request to check if URL is accessible
      const response = await fetch(item.url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (!response.ok) {
        inaccessible.push({
          index: i,
          url: item.url,
          error: `HTTP ${response.status}: ${response.statusText}`,
        });
      } else {
        accessible++;
        // Log content type if available
        const contentType = response.headers.get("content-type");
        if (contentType) {
          logger.debug(`Media item ${i} (${item.type}): Content-Type: ${contentType}`);
        }
      }
    } catch (error) {
      inaccessible.push({
        index: i,
        url: item.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { accessible, inaccessible };
}

function logGrammyError(
  logger: ReturnType<typeof createLogger>,
  error: GrammyError,
  context: string
): void {
  const errorCode = error.error_code ?? "unknown";
  const description = error.description ?? error.message;
  logger.error(
    `${context}: Telegram API error ${errorCode} - ${description}`
  );
  if (error.error_code) {
    logger.debug(`Error code: ${error.error_code}`);
  }
  if (error.description) {
    logger.debug(`Error description: ${error.description}`);
  }
}

function getBot(): Bot | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return null;
  }
  const bot = new Bot(token);
  // Apply auto-retry plugin with exponential backoff for transient errors
  bot.api.config.use(
    autoRetry({
      maxRetries: 3,
      maxDelaySeconds: 60,
      retryOnInternalServerErrors: true,
    })
  );
  return bot;
}

async function sendPost(
  bot: Bot,
  chatId: string,
  post: Doc<"posts">,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  const caption = createCaption(post);

  // Load media items for this post
  const mediaItems = await getHttpClient().query(
    api.media_items.getMediaItemsByPostId,
    { postId: post._id }
  );

  const valid = mediaItems
    .filter((m) => m.type === "image" || m.type === "video")
    .map((m) => ({ url: m.url, type: m.type as "image" | "video" }))
    .slice(0, 10);

  logger.debug(
    `Sending post ${post._id} with ${valid.length} media items (total: ${mediaItems.length})`
  );

  try {
    if (valid.length > 1) {
      // Validate media group before attempting to send
      const validation = validateMediaGroup(valid, caption);
      
      if (validation.warnings.length > 0) {
        logger.warn(`Media group warnings for post ${post._id}: ${validation.warnings.join(", ")}`);
      }

      if (!validation.isValid) {
        logger.error(`Media group validation failed for post ${post._id}:`);
        for (const error of validation.errors) {
          logger.error(`  - ${error}`);
        }
        logger.debug(`Media items: ${JSON.stringify(valid.map((m, idx) => ({ index: idx, type: m.type, url: m.url })))}`);
        throw new Error(`Media group validation failed: ${validation.errors.join("; ")}`);
      }

      // Check URL accessibility
      logger.debug(`Validating URL accessibility for ${valid.length} media items...`);
      const urlValidation = await validateMediaUrls(valid, logger);
      
      if (urlValidation.inaccessible.length > 0) {
        logger.error(`Inaccessible URLs detected for post ${post._id}:`);
        for (const item of urlValidation.inaccessible) {
          logger.error(`  - Item ${item.index} (${valid[item.index]?.type}): ${item.error} - ${item.url}`);
        }
        logger.warn(`Only ${urlValidation.accessible} of ${valid.length} URLs are accessible`);
      } else {
        logger.debug(`All ${valid.length} media URLs are accessible`);
      }

      await sendMediaGroup(bot, chatId, valid, caption, logger);
      return;
    }
    if (await tryPrimaryMedia(bot, chatId, post, caption)) {
      return;
    }
    if (await trySingleValidMedia(bot, chatId, valid, caption)) {
      return;
    }
    await bot.api.sendMessage(chatId, caption, { parse_mode: "HTML" });
  } catch (error) {
    if (error instanceof GrammyError) {
      logGrammyError(logger, error, `Failed to send post ${post._id}`);
      logger.debug(
        `Post details: ${JSON.stringify({
          postId: post._id,
          mediaType: post.media_type,
          mediaCount: valid.length,
          hasVideoUrl: !!post.video_url,
          hasDisplayUrl: !!post.display_url,
        })}`
      );
    }
    throw error;
  }
}


async function sendMediaGroup(
  bot: Bot,
  chatId: string,
  media: Array<{ url: string; type: "image" | "video" }>,
  caption: string,
  logger: ReturnType<typeof createLogger>
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

    const mediaGroup = media.map((m, idx) => {
      const cap = idx === media.length - 1 ? caption : undefined;
      return m.type === "video"
        ? InputMediaBuilder.video(m.url, { caption: cap, parse_mode: "HTML" })
        : InputMediaBuilder.photo(m.url, { caption: cap, parse_mode: "HTML" });
    });
    
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
      
      // Log specific error details
      if (error.error_code === 400) {
        logger.error("Bad Request (400) - Common causes:");
        logger.error("  - Invalid media URLs or file identifiers");
        logger.error("  - Media files too large");
        logger.error("  - Unsupported media formats");
        logger.error("  - Videos without audio tracks (known Telegram API issue)");
      } else if (error.error_code === 413) {
        logger.error("Payload Too Large (413) - Media group exceeds size limits");
      } else if (error.error_code === 429) {
        logger.error("Rate Limit (429) - Too many requests (auto-retry should handle this)");
      }
    }
    throw error;
  }
}

async function tryPrimaryMedia(
  bot: Bot,
  chatId: string,
  post: Doc<"posts">,
  caption: string
): Promise<boolean> {
  if (post.media_type === "video" && post.video_url) {
    await bot.api.sendVideo(chatId, post.video_url, {
      caption,
      parse_mode: "HTML",
    });
    return true;
  }
  if (post.media_type === "image" && post.display_url) {
    await bot.api.sendPhoto(chatId, post.display_url, {
      caption,
      parse_mode: "HTML",
    });
    return true;
  }
  return false;
}

async function trySingleValidMedia(
  bot: Bot,
  chatId: string,
  media: Array<{ url: string; type: "image" | "video" }>,
  caption: string
): Promise<boolean> {
  if (media.length !== 1) {
    return false;
  }
  const m = media[0];
  if (!m) {
    return false;
  }
  if (m.type === "video") {
    await bot.api.sendVideo(chatId, m.url, { caption, parse_mode: "HTML" });
  } else {
    await bot.api.sendPhoto(chatId, m.url, { caption, parse_mode: "HTML" });
  }
  return true;
}

export async function runTelegramOnce(): Promise<void> {
  const settings = await getEffectiveSettings();
  const logger = createLogger(
    !!(settings.logging?.active || process.env.DEBUG)
  );
  if (!settings.telegram.active) {
    return;
  }
  const bot = getBot();
  if (!bot) {
    return;
  }

  const chatId =
    settings.telegram.group_chat_id || settings.telegram.admin_chat_id;
  if (!chatId) {
    return;
  }

  const limit = settings.telegram.send_limit ?? DEFAULT_SEND_LIMIT;
  const unsent = await getHttpClient().query(api.posts.getUnsent, { limit });
  logger.info(`Sending ${unsent.length} unsent posts`);

  for (const post of unsent) {
    try {
      await sendPost(bot, chatId, post, logger);
      await getHttpClient().mutation(api.posts.markSent, {
        id: post._id,
        sentAt: Date.now(),
      });
    } catch (error) {
      // Log error but continue processing other posts
      if (error instanceof GrammyError) {
        logGrammyError(logger, error, `Failed to send post ${post._id}, skipping`);
      } else {
        logger.error(`Failed to send post ${post._id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      // Don't mark as sent if sending failed
      // Continue to next post
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function linkMentions(html: string): string {
  return html.replace(
    /@([a-zA-Z0-9._]+)/g,
    (_match, username: string) =>
      `<a href="https://instagram.com/${username}">@${username}</a>`
  );
}

function createCaption(post: Doc<"posts">): string {
  const maxLen = 1024;
  let caption = post.caption ? escapeHtml(post.caption.trim()) : "";
  if (caption) {
    caption = linkMentions(caption);
  }
  const link = post.url
    ? `\n\n<a href="${post.url}">View on Instagram</a>`
    : "";
  let combined = caption + link;
  if (combined.length > maxLen) {
    if (link) {
      const allowed = Math.max(0, maxLen - link.length);
      combined = caption.slice(0, allowed) + link;
    } else {
      combined = caption.slice(0, maxLen);
    }
  }
  return combined;
}
