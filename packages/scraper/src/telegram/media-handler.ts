import type { MediaItem, MediaItemWithThumbnail, MediaValidationResult, UrlValidationResult } from "./types";
import { MAX_MEDIA_GROUP_SIZE, MIN_MEDIA_GROUP_SIZE } from "./types";
import { createLogger } from "../infra/logger";
import { InputMediaBuilder } from "grammy";

type Logger = ReturnType<typeof createLogger>;

/**
 * Validate media group constraints
 */
export function validateMediaGroup(
  media: MediaItem[],
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

/**
 * Check URL accessibility with timeout
 */
export async function validateMediaUrls(
  media: MediaItem[],
  logger: Logger
): Promise<UrlValidationResult> {
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

/**
 * Check if URL is valid for Telegram media
 */
function isValidMediaUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);

    // Must be HTTPS for security
    if (parsedUrl.protocol !== "https:") {
      return false;
    }

    // Check for common image/video extensions
    const pathname = parsedUrl.pathname.toLowerCase();
    const validExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp", // Images
      ".mp4",
      ".mov",
      ".avi",
      ".mkv",
      ".webm", // Videos
    ];

    const hasValidExtension = validExtensions.some((ext) =>
      pathname.endsWith(ext)
    );

    // For Instagram URLs, be more lenient - they often don't have extensions
    const isInstagramUrl =
      parsedUrl.hostname.includes("instagram.com") ||
      parsedUrl.hostname.includes("cdninstagram.com") ||
      parsedUrl.hostname.includes("fbcdn.net");

    return hasValidExtension || isInstagramUrl;
  } catch {
    return false;
  }
}

/**
 * Check if media is within Telegram size limits
 */
function isWithinSizeLimits(item: MediaItemWithThumbnail): boolean {
  // Telegram limits:
  // - Photos: up to 10MB
  // - Videos: up to 50MB
  // - Dimensions: up to 4096x4096

  const maxDimension = 4096;

  if (item.width && item.width > maxDimension) return false;
  if (item.height && item.height > maxDimension) return false;

  // Note: We can't check actual file size without downloading,
  // so we rely on URL validation and let Telegram handle size errors
  return true;
}

/**
 * Fix video detection issue: Instagram video thumbnails have .jpg extension
 */
function correctVideoThumbnails(item: MediaItemWithThumbnail): MediaItem {
  let correctedType = item.type;
  if (
    item.type === "video" &&
    (item.url.includes(".jpg") ||
      item.url.includes(".jpeg") ||
      item.url.includes(".png") ||
      item.url.includes(".heic"))
  ) {
    correctedType = "image";
  }

  return {
    url: item.url,
    type: correctedType as "image" | "video",
    width: item.width,
    height: item.height,
  };
}

/**
 * Validate and filter media items for sending
 */
export async function validateAndFilterMediaItems(
  mediaItems: MediaItemWithThumbnail[],
  logger: Logger,
  verbose = false
): Promise<MediaItem[]> {
  const validMedia: MediaItem[] = [];

  if (verbose) {
    logger.debug(`Validating ${mediaItems.length} media items:`);
  }

  for (const item of mediaItems) {
    if (verbose) {
      logger.debug(`  📄 Item: ${item.type} - ${item.url}`);
    }

    // Skip thumbnails and invalid types
    if (item.type !== "image" && item.type !== "video") {
      if (verbose) {
        logger.debug(`    ❌ Skipped: Invalid type (${item.type})`);
      }
      continue;
    }

    // Basic URL validation
    if (!isValidMediaUrl(item.url)) {
      if (verbose) {
        logger.debug(`    ❌ Skipped: Invalid URL format`);
      }
      continue;
    }

    // Check file size limits (Telegram limits)
    if (!isWithinSizeLimits(item)) {
      if (verbose) {
        logger.debug(
          `    ❌ Skipped: Too large (${item.width}x${item.height})`
        );
      }
      continue;
    }

    // Fix video detection issue: Instagram video thumbnails have .jpg extension
    const corrected = correctVideoThumbnails(item);

    if (verbose) {
      logger.debug(`    ✅ Valid: ${corrected.type} - ${item.url}`);
    }
    validMedia.push(corrected);

    // Telegram media group limit
    if (validMedia.length >= MAX_MEDIA_GROUP_SIZE) {
      if (verbose) {
        logger.debug(`    ⚠️ Reached Telegram limit (${MAX_MEDIA_GROUP_SIZE} items)`);
      }
      break;
    }
  }

  if (verbose) {
    logger.debug(
      `📊 Validation result: ${validMedia.length}/${mediaItems.length} valid items`
    );
  }
  return validMedia;
}

/**
 * Build InputMedia array for media group
 */
export function buildMediaGroup(
  mediaItems: MediaItem[],
  caption: string
): Array<import("grammy").InputMediaPhoto | import("grammy").InputMediaVideo> {
  return mediaItems.map((item, index) => {
    const isLast = index === mediaItems.length - 1;
    const mediaCaption = isLast ? caption : undefined;

    if (item.type === "video") {
      return InputMediaBuilder.video(item.url, {
        caption: mediaCaption,
        parse_mode: "HTML",
      });
    } else {
      return InputMediaBuilder.photo(item.url, {
        caption: mediaCaption,
        parse_mode: "HTML",
      });
    }
  });
}

