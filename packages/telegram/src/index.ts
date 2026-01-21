// Re-export grammy types for convenience

export type { Api, Context, RawApi } from "grammy";
export { Bot, GrammyError, HttpError, InputMediaBuilder } from "grammy";
// Admin utilities
export {
  type AdminContext,
  type AdminContextFlavor,
  type AdminLogger,
  type AuthCacheConfig,
  type AuthProvider,
  adminErrorMiddleware,
  type BaseSessionData,
  buildPaginationButtons,
  type CreateAuthMiddlewareOptions,
  createAuthMiddleware,
  createErrorMiddleware,
  type DataProvider,
  DEFAULT_ITEMS_PER_PAGE,
  formatPaginatedList,
  getPaginationOpts,
  handlePaginationNavigation,
  Menu,
  type MenuFlavor,
  type MenuRange,
  type SettingsProvider,
} from "./admin";
// Bot factory
export {
  applyAutoRetry,
  type CreateBotOptions,
  createBot,
  createBotFromEnv,
  DEFAULT_AUTO_RETRY_CONFIG,
} from "./bot";
// Error handling
export {
  classifyError,
  type ErrorLogger,
  getRetryAfter,
  handleTelegramApiError,
  isPermanentError,
  isRecoverableError,
  isRetryableError,
  logGrammyError,
  requiresFallback,
  type TelegramErrorType,
} from "./errors";
// Formatting utilities
export {
  bold,
  code,
  escapeHtml,
  escapeMarkdownV2,
  type FormattedString,
  fmt,
  instagramFooter,
  instagramMention,
  italic,
  link,
  linkInstagramMentions,
  MAX_CAPTION_LENGTH,
  MAX_MESSAGE_LENGTH,
  pre,
  spoiler,
  strikethrough,
  truncateAtWordBoundary,
  truncateText,
  truncateWithFooter,
  underline,
} from "./formatting";
// Logger types
export type { Logger } from "./logger/types";
// Media utilities
export {
  buildMediaGroup,
  buildMediaItem,
  isValidMediaUrl,
  isWithinSizeLimits,
  MAX_DIMENSION,
  MAX_MEDIA_GROUP_SIZE,
  MAX_PHOTO_SIZE_MB,
  MAX_VIDEO_SIZE_MB,
  type MediaItem,
  type MediaItemWithThumbnail,
  type MediaLogger,
  type MediaValidationResult,
  MIN_MEDIA_GROUP_SIZE,
  type UrlValidationResult,
  validateAndFilterMediaItems,
  validateMediaGroup,
  validateMediaUrls,
} from "./media";
