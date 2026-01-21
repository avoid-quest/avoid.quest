import type {
  MediaItem,
  MediaItemWithThumbnail,
  MediaLogger,
  MediaValidationResult,
} from "./types";
import {
  MAX_DIMENSION,
  MAX_MEDIA_GROUP_SIZE,
  MIN_MEDIA_GROUP_SIZE,
} from "./types";

function validateMediaCount(count: number, errors: string[]): void {
  if (count < MIN_MEDIA_GROUP_SIZE) {
    errors.push(
      `Media group must have at least ${MIN_MEDIA_GROUP_SIZE} items, got ${count}`
    );
  }
  if (count > MAX_MEDIA_GROUP_SIZE) {
    errors.push(
      `Media group exceeds maximum of ${MAX_MEDIA_GROUP_SIZE} items, got ${count}`
    );
  }
}

function validateMediaItem(
  item: MediaItem | undefined,
  index: number,
  errors: string[]
): void {
  if (!item) {
    errors.push(`Media item at index ${index} is null or undefined`);
    return;
  }

  if (!item.url || typeof item.url !== "string") {
    errors.push(`Media item at index ${index} has invalid URL: ${item.url}`);
    return;
  }

  try {
    const url = new URL(item.url);
    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push(
        `Media item at index ${index} has invalid protocol: ${url.protocol}`
      );
    }
  } catch {
    errors.push(`Media item at index ${index} has malformed URL: ${item.url}`);
  }

  if (item.type !== "image" && item.type !== "video") {
    errors.push(`Media item at index ${index} has invalid type: ${item.type}`);
  }
}

function checkMixedMediaTypes(media: MediaItem[], warnings: string[]): void {
  const hasVideos = media.some((m) => m.type === "video");
  const hasImages = media.some((m) => m.type === "image");
  if (hasVideos && hasImages) {
    warnings.push(
      "Media group contains both videos and images - this may cause issues with some Telegram clients"
    );
  }
}

/**
 * Validate media group constraints (count, URLs, types)
 */
export function validateMediaGroup(media: MediaItem[]): MediaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  validateMediaCount(media.length, errors);

  for (let i = 0; i < media.length; i++) {
    validateMediaItem(media[i], i, errors);
  }

  checkMixedMediaTypes(media, warnings);

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if URL is valid for Telegram media
 * Telegram accepts both HTTP and HTTPS URLs for media
 */
export function isValidMediaUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);

    // Telegram accepts both HTTP and HTTPS for media URLs
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return false;
    }

    const pathname = parsedUrl.pathname.toLowerCase();
    const validExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".mp4",
      ".mov",
      ".avi",
      ".mkv",
      ".webm",
    ];

    const hasValidExtension = validExtensions.some((ext) =>
      pathname.endsWith(ext)
    );

    // Instagram URLs often don't have extensions
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
export function isWithinSizeLimits(item: MediaItemWithThumbnail): boolean {
  if (item.width && item.width > MAX_DIMENSION) {
    return false;
  }
  if (item.height && item.height > MAX_DIMENSION) {
    return false;
  }
  return true;
}

/**
 * Fix video detection: Instagram video thumbnails have image extensions
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

function shouldSkipMediaItem(
  item: MediaItemWithThumbnail,
  verbose: boolean,
  logger: MediaLogger
): boolean {
  if (item.type !== "image" && item.type !== "video") {
    if (verbose) {
      logger.debug(`    Skipped: Invalid type (${item.type})`);
    }
    return true;
  }

  if (!isValidMediaUrl(item.url)) {
    if (verbose) {
      logger.debug("    Skipped: Invalid URL format");
    }
    return true;
  }

  if (!isWithinSizeLimits(item)) {
    if (verbose) {
      logger.debug(`    Skipped: Too large (${item.width}x${item.height})`);
    }
    return true;
  }

  return false;
}

/**
 * Validate and filter media items for sending
 */
export function validateAndFilterMediaItems(
  mediaItems: MediaItemWithThumbnail[],
  logger: MediaLogger,
  verbose = false
): MediaItem[] {
  const validMedia: MediaItem[] = [];

  if (verbose) {
    logger.debug(`Validating ${mediaItems.length} media items:`);
  }

  for (const item of mediaItems) {
    if (verbose) {
      logger.debug(`  Item: ${item.type} - ${item.url}`);
    }

    if (shouldSkipMediaItem(item, verbose, logger)) {
      continue;
    }

    const corrected = correctVideoThumbnails(item);

    if (verbose) {
      logger.debug(`    Valid: ${corrected.type} - ${item.url}`);
    }
    validMedia.push(corrected);

    if (validMedia.length >= MAX_MEDIA_GROUP_SIZE) {
      if (verbose) {
        logger.debug(
          `    Reached Telegram limit (${MAX_MEDIA_GROUP_SIZE} items)`
        );
      }
      break;
    }
  }

  if (verbose) {
    logger.debug(
      `Validation result: ${validMedia.length}/${mediaItems.length} valid items`
    );
  }
  return validMedia;
}
