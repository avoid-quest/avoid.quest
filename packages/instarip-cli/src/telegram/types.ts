import type { Doc } from "@workspace/backend/convex/_generated/dataModel";

// Re-export types and constants from @avoid.quest/telegram
export {
  MAX_CAPTION_LENGTH,
  MAX_MEDIA_GROUP_SIZE,
  type MediaItem,
  type MediaItemWithThumbnail,
  type MediaValidationResult,
  MIN_MEDIA_GROUP_SIZE,
  type TelegramMediaItem,
  type UrlValidationResult,
} from "@avoid.quest/telegram";

// App-specific constants
export const DEFAULT_SEND_LIMIT = 3;

// Re-import for local use
import type { MediaItem } from "@avoid.quest/telegram";

// Post with media items attached (app-specific)
export type PostWithMedia = {
  post: Doc<"posts">;
  mediaItems: MediaItem[];
};

// Logger type for this app
export type Logger = {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};
