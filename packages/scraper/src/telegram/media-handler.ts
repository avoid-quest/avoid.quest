import { InputMediaBuilder } from "grammy";
import type { createLogger } from "../infra/logger";
import type {
  MediaItem,
  MediaItemWithThumbnail,
  MediaValidationResult,
  UrlValidationResult,
} from "./types";
import { MAX_MEDIA_GROUP_SIZE, MIN_MEDIA_GROUP_SIZE } from "./types";

type Logger = ReturnType<typeof createLogger>;

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

  // Check URL format
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

  // Validate media type
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
 * Validate media group constraints
 */
export function validateMediaGroup(
  media: MediaItem[],
  _caption: string
): MediaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  validateMediaCount(media.length, errors);

  // Validate URLs
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
 * Check if Instagram URL might be expired based on URL pattern
 * Instagram CDN URLs with certain patterns are more likely to be expired
 */
function _isLikelyExpiredInstagramUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    // Instagram CDN URLs
    if (
      urlObj.hostname.includes("cdninstagram.com") ||
      urlObj.hostname.includes("fbcdn.net")
    ) {
      // Check for expiration indicators in query params
      // Instagram URLs with `oe=` parameter might expire
      // URLs older than a certain pattern might be expired
      // This is a heuristic - actual expiration requires HTTP check
      return false; // Don't pre-filter, let HTTP check determine
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check URL accessibility with timeout and retry logic
 * Improved to better detect expired Instagram URLs and handle transient errors
 */
const HTTP_TIMEOUT_MS = 5000;
const HTTP_STATUS_FORBIDDEN = 403;
const HTTP_STATUS_NOT_FOUND = 404;
const RETRY_BACKOFF_BASE_MS = 100;

function getRequestMethod(url: string): "GET" | "HEAD" {
  // Use GET for Instagram URLs as some don't support HEAD
  if (url.includes("cdninstagram.com") || url.includes("fbcdn.net")) {
    return "GET";
  }
  return "HEAD";
}

function isPermanentError(status: number): boolean {
  return status === HTTP_STATUS_FORBIDDEN || status === HTTP_STATUS_NOT_FOUND;
}

function isTransientNetworkError(errorMsg: string): boolean {
  return (
    errorMsg.includes("timeout") ||
    errorMsg.includes("network") ||
    errorMsg.includes("ECONNREFUSED") ||
    errorMsg.includes("ETIMEDOUT")
  );
}

async function waitForRetry(attempt: number): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(resolve, RETRY_BACKOFF_BASE_MS * (attempt + 1))
  );
}

async function attemptUrlValidation(
  item: MediaItem,
  index: number,
  logger: Logger
): Promise<{ success: boolean; error: string | null; isPermanent: boolean }> {
  try {
    const method = getRequestMethod(item.url);
    const response = await fetch(item.url, {
      method,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: {
        // Add user agent to avoid some blocking
        "User-Agent": "Mozilla/5.0 (compatible; TelegramBot/1.0)",
      },
    });

    if (response.ok) {
      // Log content type if available
      const contentType = response.headers.get("content-type");
      if (contentType) {
        logger.debug(
          `Media item ${index} (${item.type}): Content-Type: ${contentType}`
        );
      }
      return { success: true, error: null, isPermanent: false };
    }

    const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
    const isPermanent = isPermanentError(response.status);

    if (response.status === HTTP_STATUS_FORBIDDEN) {
      return {
        success: false,
        error: `${errorMsg} - URL may be expired or blocked`,
        isPermanent: true,
      };
    }

    if (response.status === HTTP_STATUS_NOT_FOUND) {
      return {
        success: false,
        error: `${errorMsg} - URL not found`,
        isPermanent: true,
      };
    }

    return { success: false, error: errorMsg, isPermanent };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isPermanent = !isTransientNetworkError(errorMsg);

    if (errorMsg.includes("Malformed_HTTP_Response")) {
      return {
        success: false,
        error: `${errorMsg} - URL may be expired or server error`,
        isPermanent: true,
      };
    }

    return { success: false, error: errorMsg, isPermanent };
  }
}

async function validateSingleMediaUrl(
  item: MediaItem,
  index: number,
  logger: Logger,
  retries: number
): Promise<{ success: boolean; error: string | null }> {
  // Retry logic for transient errors
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await attemptUrlValidation(item, index, logger);

    if (result.success) {
      return { success: true, error: null };
    }

    if (result.isPermanent) {
      return { success: false, error: result.error };
    }

    // Transient error - retry if attempts remain
    if (attempt < retries) {
      await waitForRetry(attempt);
      continue;
    }

    // Max retries reached
    return { success: false, error: result.error };
  }

  return { success: false, error: "Max retries exceeded" };
}

export async function validateMediaUrls(
  media: MediaItem[],
  logger: Logger,
  retries = 1
): Promise<UrlValidationResult> {
  const inaccessible: Array<{ index: number; url: string; error: string }> = [];
  let accessible = 0;

  for (let i = 0; i < media.length; i++) {
    const item = media[i];
    if (!item) {
      continue;
    }

    const result = await validateSingleMediaUrl(item, i, logger, retries);
    if (result.success) {
      accessible++;
    } else if (result.error) {
      inaccessible.push({
        index: i,
        url: item.url,
        error: result.error,
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

  if (item.width && item.width > maxDimension) {
    return false;
  }
  if (item.height && item.height > maxDimension) {
    return false;
  }

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

function shouldSkipMediaItem(
  item: MediaItemWithThumbnail,
  verbose: boolean,
  logger: Logger
): boolean {
  // Skip thumbnails and invalid types
  if (item.type !== "image" && item.type !== "video") {
    if (verbose) {
      logger.debug(`    ❌ Skipped: Invalid type (${item.type})`);
    }
    return true;
  }

  // Basic URL validation
  if (!isValidMediaUrl(item.url)) {
    if (verbose) {
      logger.debug("    ❌ Skipped: Invalid URL format");
    }
    return true;
  }

  // Check file size limits (Telegram limits)
  if (!isWithinSizeLimits(item)) {
    if (verbose) {
      logger.debug(`    ❌ Skipped: Too large (${item.width}x${item.height})`);
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
  logger: Logger,
  verbose = false
): MediaItem[] {
  const validMedia: MediaItem[] = [];

  if (verbose) {
    logger.debug(`Validating ${mediaItems.length} media items:`);
  }

  for (const item of mediaItems) {
    if (verbose) {
      logger.debug(`  📄 Item: ${item.type} - ${item.url}`);
    }

    if (shouldSkipMediaItem(item, verbose, logger)) {
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
        logger.debug(
          `    ⚠️ Reached Telegram limit (${MAX_MEDIA_GROUP_SIZE} items)`
        );
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
    }
    return InputMediaBuilder.photo(item.url, {
      caption: mediaCaption,
      parse_mode: "HTML",
    });
  });
}
