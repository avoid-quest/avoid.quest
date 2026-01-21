/**
 * Telegram API constraints for media groups
 */
export const MAX_MEDIA_GROUP_SIZE = 10;
export const MIN_MEDIA_GROUP_SIZE = 2;

/**
 * Telegram size limits
 */
export const MAX_PHOTO_SIZE_MB = 10;
export const MAX_VIDEO_SIZE_MB = 50;
export const MAX_DIMENSION = 4096;

/**
 * A media item for Telegram (URL-based, for backwards compatibility)
 */
export type MediaItem = {
  url: string;
  type: "image" | "video";
  width?: number;
  height?: number;
};

/**
 * A media item stored with Telegram file_id (permanent storage)
 */
export type TelegramMediaItem = {
  file_id: string;
  file_unique_id: string;
  type: "image" | "video";
  width?: number;
  height?: number;
};

/**
 * Media item that may include thumbnail type (used before filtering)
 */
export type MediaItemWithThumbnail = {
  url: string;
  type: "image" | "video" | "thumbnail";
  width?: number;
  height?: number;
};

/**
 * Result of validating a media group
 */
export type MediaValidationResult = {
  isValid: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * Result of checking URL accessibility
 */
export type UrlValidationResult = {
  accessible: number;
  inaccessible: Array<{
    index: number;
    url: string;
    error: string;
  }>;
};

/**
 * Logger interface for media operations
 */
export type MediaLogger = {
  debug: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};
