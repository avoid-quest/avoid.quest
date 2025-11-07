import type { Doc } from "@workspace/backend/convex/_generated/dataModel";

// Telegram API constraints
export const MAX_MEDIA_GROUP_SIZE = 10;
export const MIN_MEDIA_GROUP_SIZE = 2;
export const MAX_CAPTION_LENGTH = 1024;
export const DEFAULT_SEND_LIMIT = 3;

// Media item types
export interface MediaItem {
  url: string;
  type: "image" | "video";
  width?: number;
  height?: number;
}

export interface MediaItemWithThumbnail extends MediaItem {
  type: "image" | "video" | "thumbnail";
}

// Post with media items attached
export interface PostWithMedia {
  post: Doc<"posts">;
  mediaItems: MediaItem[];
}

// Media validation results
export interface MediaValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// URL validation results
export interface UrlValidationResult {
  accessible: number;
  inaccessible: Array<{
    index: number;
    url: string;
    error: string;
  }>;
}

