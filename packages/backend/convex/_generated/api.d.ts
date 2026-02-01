/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as api_admin from "../api/admin.js";
import type * as api_backfill from "../api/backfill.js";
import type * as api_media from "../api/media.js";
import type * as api_posts from "../api/posts.js";
import type * as api_users from "../api/users.js";
import type * as bootstrap from "../bootstrap.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as httpHandlers_media from "../httpHandlers/media.js";
import type * as instarip_bot from "../instarip/bot.js";
import type * as instarip_handlers_textInput from "../instarip/handlers/textInput.js";
import type * as instarip_menu_actionsMenu from "../instarip/menu/actionsMenu.js";
import type * as instarip_menu_index from "../instarip/menu/index.js";
import type * as instarip_menu_mainMenu from "../instarip/menu/mainMenu.js";
import type * as instarip_menu_settingsMenu from "../instarip/menu/settingsMenu.js";
import type * as instarip_menu_usersMenu from "../instarip/menu/usersMenu.js";
import type * as instarip_webhook from "../instarip/webhook.js";
import type * as lib_config_defaults from "../lib/config/defaults.js";
import type * as lib_config_index from "../lib/config/index.js";
import type * as lib_dateExtractor_extractor from "../lib/dateExtractor/extractor.js";
import type * as lib_dateExtractor_index from "../lib/dateExtractor/index.js";
import type * as lib_dateExtractor_parsers_ITEuropeanDateParser from "../lib/dateExtractor/parsers/ITEuropeanDateParser.js";
import type * as lib_dateExtractor_parsers_ITWeekendParser from "../lib/dateExtractor/parsers/ITWeekendParser.js";
import type * as lib_dateExtractor_parsers_index from "../lib/dateExtractor/parsers/index.js";
import type * as lib_dateExtractor_types from "../lib/dateExtractor/types.js";
import type * as lib_fileIdMatcher from "../lib/fileIdMatcher.js";
import type * as lib_logger from "../lib/logger.js";
import type * as lib_security from "../lib/security.js";
import type * as lib_validators_index from "../lib/validators/index.js";
import type * as lib_validators_media from "../lib/validators/media.js";
import type * as sessions from "../sessions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "api/admin": typeof api_admin;
  "api/backfill": typeof api_backfill;
  "api/media": typeof api_media;
  "api/posts": typeof api_posts;
  "api/users": typeof api_users;
  bootstrap: typeof bootstrap;
  crons: typeof crons;
  http: typeof http;
  "httpHandlers/media": typeof httpHandlers_media;
  "instarip/bot": typeof instarip_bot;
  "instarip/handlers/textInput": typeof instarip_handlers_textInput;
  "instarip/menu/actionsMenu": typeof instarip_menu_actionsMenu;
  "instarip/menu/index": typeof instarip_menu_index;
  "instarip/menu/mainMenu": typeof instarip_menu_mainMenu;
  "instarip/menu/settingsMenu": typeof instarip_menu_settingsMenu;
  "instarip/menu/usersMenu": typeof instarip_menu_usersMenu;
  "instarip/webhook": typeof instarip_webhook;
  "lib/config/defaults": typeof lib_config_defaults;
  "lib/config/index": typeof lib_config_index;
  "lib/dateExtractor/extractor": typeof lib_dateExtractor_extractor;
  "lib/dateExtractor/index": typeof lib_dateExtractor_index;
  "lib/dateExtractor/parsers/ITEuropeanDateParser": typeof lib_dateExtractor_parsers_ITEuropeanDateParser;
  "lib/dateExtractor/parsers/ITWeekendParser": typeof lib_dateExtractor_parsers_ITWeekendParser;
  "lib/dateExtractor/parsers/index": typeof lib_dateExtractor_parsers_index;
  "lib/dateExtractor/types": typeof lib_dateExtractor_types;
  "lib/fileIdMatcher": typeof lib_fileIdMatcher;
  "lib/logger": typeof lib_logger;
  "lib/security": typeof lib_security;
  "lib/validators/index": typeof lib_validators_index;
  "lib/validators/media": typeof lib_validators_media;
  sessions: typeof sessions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: {
    lib: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        { name: string },
        {
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }
      >;
      cancelAll: FunctionReference<
        "mutation",
        "internal",
        { sinceTs?: number },
        Array<{
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }>
      >;
      clearAll: FunctionReference<
        "mutation",
        "internal",
        { before?: number },
        null
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { limit?: number; names?: Array<string> },
        Array<{
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }>
      >;
      migrate: FunctionReference<
        "mutation",
        "internal",
        {
          batchSize?: number;
          cursor?: string | null;
          dryRun: boolean;
          fnHandle: string;
          name: string;
          next?: Array<{ fnHandle: string; name: string }>;
          oneBatchOnly?: boolean;
        },
        {
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }
      >;
    };
  };
  instarip: {
    admin: {
      getTelegramMessageIds: FunctionReference<
        "mutation",
        "internal",
        { chatId?: string },
        any
      >;
      wipePostData: FunctionReference<
        "mutation",
        "internal",
        { confirm: boolean },
        any
      >;
    };
    fetcher: {
      cleanupOldLogs: FunctionReference<"mutation", "internal", {}, number>;
      fetchPost: FunctionReference<
        "action",
        "internal",
        { postUrl: string },
        {
          error?: string;
          post?: {
            caption: string;
            collaborators: Array<string>;
            display_url: string;
            id: string;
            is_video: boolean;
            location?: { ig_id: string; name: string; slug: string };
            media_items: Array<{
              height?: number;
              type: "image" | "video" | "thumbnail";
              url: string;
              width?: number;
            }>;
            media_type: "image" | "video" | "carousel";
            shortcode: string;
            thumbnail_url?: string;
            timestamp: number;
            url: string;
            video_url?: string;
          };
          success: boolean;
        }
      >;
      fetchUser: FunctionReference<
        "action",
        "internal",
        { limit?: number; username: string },
        {
          error?: string;
          posts: Array<{
            caption: string;
            collaborators: Array<string>;
            display_url: string;
            id: string;
            is_video: boolean;
            location?: { ig_id: string; name: string; slug: string };
            media_items: Array<{
              height?: number;
              type: "image" | "video" | "thumbnail";
              url: string;
              width?: number;
            }>;
            media_type: "image" | "video" | "carousel";
            shortcode: string;
            thumbnail_url?: string;
            timestamp: number;
            url: string;
            video_url?: string;
          }>;
          success: boolean;
        }
      >;
      getFetchLogs: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        any
      >;
      getFetchLogsByUsername: FunctionReference<
        "query",
        "internal",
        { limit?: number; username: string },
        any
      >;
      logFetch: FunctionReference<
        "mutation",
        "internal",
        {
          error?: string;
          posts_fetched: number;
          success: boolean;
          username: string;
        },
        any
      >;
      testConnectivity: FunctionReference<
        "action",
        "internal",
        {},
        { message: string; success: boolean }
      >;
    };
    mediaItems: {
      deleteMediaItem: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any
      >;
      getMediaItemById: FunctionReference<
        "query",
        "internal",
        { id: string },
        any
      >;
      getMediaItemByTypeAndPostId: FunctionReference<
        "query",
        "internal",
        { postId: string; type: "image" | "video" | "thumbnail" },
        any
      >;
      getMediaItems: FunctionReference<"query", "internal", {}, any>;
      getMediaItemsByPostId: FunctionReference<
        "query",
        "internal",
        { postId: string },
        any
      >;
      getMediaItemsNeedingBackfill: FunctionReference<
        "query",
        "internal",
        { postId: string },
        any
      >;
      syncMediaItemsForPost: FunctionReference<
        "mutation",
        "internal",
        {
          media_items: Array<{
            height?: number;
            type: "image" | "video" | "thumbnail";
            url: string;
            width?: number;
          }>;
          post_id: string;
        },
        any
      >;
      syncTelegramMediaItemsForPost: FunctionReference<
        "mutation",
        "internal",
        {
          media_items: Array<{
            file_id: string;
            file_unique_id: string;
            height?: number;
            type: "image" | "video" | "thumbnail";
            width?: number;
          }>;
          post_id: string;
        },
        any
      >;
      updateMediaItemFileIdById: FunctionReference<
        "mutation",
        "internal",
        { file_id: string; file_unique_id: string; id: string },
        any
      >;
      updateMediaItemWithFileId: FunctionReference<
        "mutation",
        "internal",
        { file_id: string; file_unique_id: string; id: string },
        any
      >;
      updateMediaItemWithFileIdByPosition: FunctionReference<
        "mutation",
        "internal",
        {
          file_id: string;
          file_unique_id: string;
          position: number;
          post_id: string;
        },
        any
      >;
      upsertMediaItem: FunctionReference<
        "mutation",
        "internal",
        {
          height?: number;
          id?: string;
          post_id: string;
          telegram_file?: { file_id: string; file_unique_id: string };
          type: "image" | "video" | "thumbnail";
          width?: number;
        },
        any
      >;
    };
    posts: {
      claimForSending: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        boolean
      >;
      clearSending: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any
      >;
      deletePost: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any
      >;
      getBackfillStats: FunctionReference<"query", "internal", any, any>;
      getCollaborators: FunctionReference<
        "query",
        "internal",
        any,
        Array<string>
      >;
      getEventDateBackfillStats: FunctionReference<
        "query",
        "internal",
        any,
        any
      >;
      getLocations: FunctionReference<
        "query",
        "internal",
        any,
        Array<{ ig_id: string; name: string; slug: string }>
      >;
      getPostById: FunctionReference<"query", "internal", { id: string }, any>;
      getPostByShortcode: FunctionReference<
        "query",
        "internal",
        { shortcode: string },
        any
      >;
      getPosts: FunctionReference<"query", "internal", { limit: number }, any>;
      getPostsByUserId: FunctionReference<
        "query",
        "internal",
        { userId: string },
        any
      >;
      getPostsNeedingDateBackfill: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        Array<{
          _id: string;
          caption: string;
          event_date?: number;
          timestamp: number;
        }>
      >;
      getPostsPaginated: FunctionReference<
        "query",
        "internal",
        { cursor?: string | null; numItems?: number },
        {
          continueCursor: string | null;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            caption: string;
            collaborators?: Array<string>;
            display_url: string;
            event_date?: number;
            ig_id: string;
            is_video: boolean;
            location?: { ig_id: string; name: string; slug: string };
            media_type: "image" | "video" | "carousel";
            sentAt?: number;
            shortcode: string;
            status: "pending" | "sending" | "sent" | "failed";
            thumbnail_url?: string;
            timestamp: number;
            url: string;
            users: Array<string>;
            video_url?: string;
          }>;
        }
      >;
      getPostsWithFilters: FunctionReference<
        "query",
        "internal",
        {
          collaborator?: string;
          endDate?: number;
          limit?: number;
          locationId?: string;
          startDate?: number;
          userId?: string;
        },
        Array<{
          _creationTime: number;
          _id: string;
          caption: string;
          collaborators?: Array<string>;
          display_url: string;
          event_date?: number;
          ig_id: string;
          is_video: boolean;
          location?: { ig_id: string; name: string; slug: string };
          media_type: "image" | "video" | "carousel";
          sentAt?: number;
          shortcode: string;
          status: "pending" | "sending" | "sent" | "failed";
          thumbnail_url?: string;
          timestamp: number;
          url: string;
          users: Array<string>;
          video_url?: string;
        }>
      >;
      getUnsent: FunctionReference<"query", "internal", { limit: number }, any>;
      getUnsentPaginated: FunctionReference<
        "query",
        "internal",
        { cursor?: string | null; numItems?: number },
        {
          continueCursor: string | null;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            caption: string;
            collaborators?: Array<string>;
            display_url: string;
            event_date?: number;
            ig_id: string;
            is_video: boolean;
            location?: { ig_id: string; name: string; slug: string };
            media_type: "image" | "video" | "carousel";
            sentAt?: number;
            shortcode: string;
            status: "pending" | "sending" | "sent" | "failed";
            thumbnail_url?: string;
            timestamp: number;
            url: string;
            users: Array<string>;
            video_url?: string;
          }>;
        }
      >;
      incrementRetryCount: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        number
      >;
      markSendFailed: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any
      >;
      markSent: FunctionReference<
        "mutation",
        "internal",
        { id: string; sentAt: number },
        any
      >;
      searchPosts: FunctionReference<
        "query",
        "internal",
        { limit?: number; query: string },
        Array<{
          _creationTime: number;
          _id: string;
          caption: string;
          collaborators?: Array<string>;
          display_url: string;
          event_date?: number;
          ig_id: string;
          is_video: boolean;
          location?: { ig_id: string; name: string; slug: string };
          media_type: "image" | "video" | "carousel";
          sentAt?: number;
          shortcode: string;
          status: "pending" | "sending" | "sent" | "failed";
          thumbnail_url?: string;
          timestamp: number;
          url: string;
          users: Array<string>;
          video_url?: string;
        }>
      >;
      updateEventDate: FunctionReference<
        "mutation",
        "internal",
        { event_date: number; id: string },
        any
      >;
      updateEventDates: FunctionReference<
        "mutation",
        "internal",
        {
          event_date: number;
          event_dates: Array<number>;
          event_period?: { end: number; start: number };
          id: string;
        },
        any
      >;
      upsertPost: FunctionReference<
        "mutation",
        "internal",
        {
          caption: string;
          collaborators?: Array<string>;
          display_url: string;
          event_date?: number;
          id?: string;
          ig_id: string;
          is_video: boolean;
          location?: { ig_id: string; name: string; slug: string };
          media_type: "image" | "video" | "carousel";
          shortcode: string;
          thumbnail_url?: string;
          timestamp: number;
          url: string;
          users: Array<string>;
          video_url?: string;
        },
        any
      >;
    };
    settings: {
      deleteSettings: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any
      >;
      ensureSettings: FunctionReference<
        "mutation",
        "internal",
        {},
        {
          _creationTime: number;
          _id: string;
          instagram?: {
            active: boolean;
            delay_between_users_max_ms?: number;
            delay_between_users_min_ms?: number;
            limit?: number;
            min_scrape_interval_ms?: number;
            post_per_user?: number;
            rate_limit_max_tokens?: number;
            rate_limit_refill_rate?: number;
            request_timeout_ms?: number;
          };
          locale?: { locale?: string; timezone?: string };
          logging?: {
            active: boolean;
            log_file?: string;
            log_level?: "debug" | "info" | "warn" | "error";
            max_retention_days?: number;
          };
          telegram?: {
            active: boolean;
            delay_between_posts_ms?: number;
            group_chat_id?: string;
            request_timeout_ms?: number;
            send_limit?: number;
            send_report: boolean;
          };
        } | null
      >;
      getSettings: FunctionReference<
        "query",
        "internal",
        {},
        {
          _creationTime: number;
          _id: string;
          instagram?: {
            active: boolean;
            delay_between_users_max_ms?: number;
            delay_between_users_min_ms?: number;
            limit?: number;
            min_scrape_interval_ms?: number;
            post_per_user?: number;
            rate_limit_max_tokens?: number;
            rate_limit_refill_rate?: number;
            request_timeout_ms?: number;
          };
          locale?: { locale?: string; timezone?: string };
          logging?: {
            active: boolean;
            log_file?: string;
            log_level?: "debug" | "info" | "warn" | "error";
            max_retention_days?: number;
          };
          telegram?: {
            active: boolean;
            delay_between_posts_ms?: number;
            group_chat_id?: string;
            request_timeout_ms?: number;
            send_limit?: number;
            send_report: boolean;
          };
        } | null
      >;
      toggleInstagramActive: FunctionReference<"mutation", "internal", {}, any>;
      toggleLoggingActive: FunctionReference<"mutation", "internal", {}, any>;
      toggleTelegramActive: FunctionReference<"mutation", "internal", {}, any>;
      toggleTelegramReport: FunctionReference<"mutation", "internal", {}, any>;
      updateSetting: FunctionReference<
        "mutation",
        "internal",
        { path: string; value: string },
        any
      >;
      upsertSettings: FunctionReference<
        "mutation",
        "internal",
        {
          id?: string;
          instagram?: {
            active: boolean;
            delay_between_users_max_ms?: number;
            delay_between_users_min_ms?: number;
            limit?: number;
            min_scrape_interval_ms?: number;
            post_per_user?: number;
            rate_limit_max_tokens?: number;
            rate_limit_refill_rate?: number;
            request_timeout_ms?: number;
          };
          locale?: { locale?: string; timezone?: string };
          logging?: {
            active: boolean;
            log_file?: string;
            log_level?: "debug" | "info" | "warn" | "error";
            max_retention_days?: number;
          };
          telegram?: {
            active: boolean;
            delay_between_posts_ms?: number;
            group_chat_id?: string;
            request_timeout_ms?: number;
            send_limit?: number;
            send_report: boolean;
          };
        },
        string
      >;
    };
    telegramMessages: {
      deleteMessage: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any
      >;
      getMessageByIdAndChat: FunctionReference<
        "query",
        "internal",
        { chat_id: string; message_id: number },
        any
      >;
      getMessagesByPostId: FunctionReference<
        "query",
        "internal",
        { postId: string },
        any
      >;
      recordMessage: FunctionReference<
        "mutation",
        "internal",
        {
          chat_id: string;
          message_id: number;
          post_id: string;
          sentAt: number;
        },
        any
      >;
    };
    users: {
      createUser: FunctionReference<
        "mutation",
        "internal",
        { username: string },
        any
      >;
      deleteUser: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any
      >;
      getOrCreateUser: FunctionReference<
        "mutation",
        "internal",
        { username: string },
        any
      >;
      getUserById: FunctionReference<"query", "internal", { id: string }, any>;
      getUserByUsername: FunctionReference<
        "query",
        "internal",
        { username: string },
        any
      >;
      getUsers: FunctionReference<"query", "internal", {}, any>;
      getUsersByIds: FunctionReference<
        "query",
        "internal",
        { ids: Array<string> },
        any
      >;
      getUsersLimited: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        any
      >;
      getUsersPaginated: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string | null;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            last_scraped_at?: number;
            profile_url?: string;
            to_be_scraped: boolean;
            username: string;
          }>;
        }
      >;
      listToBeScraped: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        any
      >;
      listToBeScrapedWithInterval: FunctionReference<
        "query",
        "internal",
        { limit: number; minIntervalMs?: number },
        any
      >;
      toggleScraping: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any
      >;
      updateLastScrapedAt: FunctionReference<
        "mutation",
        "internal",
        { id: string; lastScrapedAt: number },
        any
      >;
      updateUsername: FunctionReference<
        "mutation",
        "internal",
        { id: string; username: string },
        any
      >;
      upsertUser: FunctionReference<
        "mutation",
        "internal",
        {
          id?: string;
          last_scraped_at?: number;
          profile_url?: string;
          to_be_scraped: boolean;
          username?: string;
        },
        any
      >;
    };
  };
  telegram: {
    admin: {
      deleteMessages: FunctionReference<
        "action",
        "internal",
        {
          botToken: string;
          chatId: string;
          delayMs?: number;
          messageIds: Array<number>;
        },
        {
          deleted: number;
          errors: Array<string>;
          failed: number;
          success: boolean;
        }
      >;
    };
    sender: {
      sendMessage: FunctionReference<
        "action",
        "internal",
        {
          botToken: string;
          caption: string;
          chatId: string;
          mediaItems: Array<
            | {
                file_id?: string;
                file_unique_id?: string;
                height?: number;
                type: "image" | "video" | "thumbnail";
                url: string;
                width?: number;
              }
            | {
                file_id: string;
                file_unique_id: string;
                height?: number;
                type: "image" | "video" | "thumbnail";
                url?: string;
                width?: number;
              }
          >;
          postUrl: string;
        },
        {
          error?: string;
          fileIds?: Array<{
            file_id: string;
            file_unique_id: string;
            type: "image" | "video";
          }>;
          messageId?: number;
          retryAfterMs?: number;
          success: boolean;
        }
      >;
      sendTextMessage: FunctionReference<
        "action",
        "internal",
        {
          botToken: string;
          chatId: string;
          disableNotification?: boolean;
          text: string;
        },
        { error?: string; messageId?: number; success: boolean }
      >;
      verifyBotToken: FunctionReference<
        "action",
        "internal",
        { botToken: string },
        { botUsername?: string; error?: string; success: boolean }
      >;
    };
  };
};
