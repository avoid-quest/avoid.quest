/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    admin: {
      getTelegramMessageIds: FunctionReference<
        "mutation",
        "internal",
        { chatId?: string },
        any,
        Name
      >;
      wipePostData: FunctionReference<
        "mutation",
        "internal",
        { confirm: boolean },
        any,
        Name
      >;
    };
    fetcher: {
      cleanupOldLogs: FunctionReference<
        "mutation",
        "internal",
        {},
        number,
        Name
      >;
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
        },
        Name
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
        },
        Name
      >;
      getFetchLogs: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        any,
        Name
      >;
      getFetchLogsByUsername: FunctionReference<
        "query",
        "internal",
        { limit?: number; username: string },
        any,
        Name
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
        any,
        Name
      >;
      testConnectivity: FunctionReference<
        "action",
        "internal",
        {},
        { message: string; success: boolean },
        Name
      >;
    };
    mediaItems: {
      deleteMediaItem: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any,
        Name
      >;
      getMediaItemById: FunctionReference<
        "query",
        "internal",
        { id: string },
        any,
        Name
      >;
      getMediaItemByTypeAndPostId: FunctionReference<
        "query",
        "internal",
        { postId: string; type: "image" | "video" | "thumbnail" },
        any,
        Name
      >;
      getMediaItems: FunctionReference<"query", "internal", {}, any, Name>;
      getMediaItemsByPostId: FunctionReference<
        "query",
        "internal",
        { postId: string },
        any,
        Name
      >;
      getMediaItemsNeedingBackfill: FunctionReference<
        "query",
        "internal",
        { postId: string },
        any,
        Name
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
        any,
        Name
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
        any,
        Name
      >;
      updateMediaItemFileIdById: FunctionReference<
        "mutation",
        "internal",
        { file_id: string; file_unique_id: string; id: string },
        any,
        Name
      >;
      updateMediaItemWithFileId: FunctionReference<
        "mutation",
        "internal",
        { file_id: string; file_unique_id: string; id: string },
        any,
        Name
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
        any,
        Name
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
        any,
        Name
      >;
    };
    posts: {
      claimForSending: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        boolean,
        Name
      >;
      clearSending: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any,
        Name
      >;
      deletePost: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any,
        Name
      >;
      getBackfillStats: FunctionReference<"query", "internal", any, any, Name>;
      getCollaborators: FunctionReference<
        "query",
        "internal",
        any,
        Array<string>,
        Name
      >;
      getEventDateBackfillStats: FunctionReference<
        "query",
        "internal",
        any,
        any,
        Name
      >;
      getLocations: FunctionReference<
        "query",
        "internal",
        any,
        Array<{ ig_id: string; name: string; slug: string }>,
        Name
      >;
      getPostById: FunctionReference<
        "query",
        "internal",
        { id: string },
        any,
        Name
      >;
      getPostByShortcode: FunctionReference<
        "query",
        "internal",
        { shortcode: string },
        any,
        Name
      >;
      getPosts: FunctionReference<
        "query",
        "internal",
        { limit: number },
        any,
        Name
      >;
      getPostsByUserId: FunctionReference<
        "query",
        "internal",
        { userId: string },
        any,
        Name
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
        }>,
        Name
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
            event_dates?: Array<number>;
            event_period?: { end: number; start: number };
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
        },
        Name
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
          event_dates?: Array<number>;
          event_period?: { end: number; start: number };
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
        }>,
        Name
      >;
      getUnsent: FunctionReference<
        "query",
        "internal",
        { limit: number },
        any,
        Name
      >;
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
            event_dates?: Array<number>;
            event_period?: { end: number; start: number };
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
        },
        Name
      >;
      incrementRetryCount: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        number,
        Name
      >;
      markSendFailed: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any,
        Name
      >;
      markSent: FunctionReference<
        "mutation",
        "internal",
        { id: string; sentAt: number },
        any,
        Name
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
          event_dates?: Array<number>;
          event_period?: { end: number; start: number };
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
        }>,
        Name
      >;
      updateEventDate: FunctionReference<
        "mutation",
        "internal",
        { event_date: number; id: string },
        any,
        Name
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
        any,
        Name
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
        any,
        Name
      >;
    };
    settings: {
      deleteSettings: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any,
        Name
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
        } | null,
        Name
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
        } | null,
        Name
      >;
      toggleInstagramActive: FunctionReference<
        "mutation",
        "internal",
        {},
        any,
        Name
      >;
      toggleLoggingActive: FunctionReference<
        "mutation",
        "internal",
        {},
        any,
        Name
      >;
      toggleTelegramActive: FunctionReference<
        "mutation",
        "internal",
        {},
        any,
        Name
      >;
      toggleTelegramReport: FunctionReference<
        "mutation",
        "internal",
        {},
        any,
        Name
      >;
      updateSetting: FunctionReference<
        "mutation",
        "internal",
        { path: string; value: string },
        any,
        Name
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
        string,
        Name
      >;
    };
    telegramMessages: {
      deleteMessage: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any,
        Name
      >;
      getMessageByIdAndChat: FunctionReference<
        "query",
        "internal",
        { chat_id: string; message_id: number },
        any,
        Name
      >;
      getMessagesByPostId: FunctionReference<
        "query",
        "internal",
        { postId: string },
        any,
        Name
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
        any,
        Name
      >;
    };
    users: {
      createUser: FunctionReference<
        "mutation",
        "internal",
        { username: string },
        any,
        Name
      >;
      deleteUser: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any,
        Name
      >;
      getOrCreateUser: FunctionReference<
        "mutation",
        "internal",
        { username: string },
        any,
        Name
      >;
      getUserById: FunctionReference<
        "query",
        "internal",
        { id: string },
        any,
        Name
      >;
      getUserByUsername: FunctionReference<
        "query",
        "internal",
        { username: string },
        any,
        Name
      >;
      getUsers: FunctionReference<"query", "internal", {}, any, Name>;
      getUsersByIds: FunctionReference<
        "query",
        "internal",
        { ids: Array<string> },
        any,
        Name
      >;
      getUsersLimited: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        any,
        Name
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
        },
        Name
      >;
      listToBeScraped: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        any,
        Name
      >;
      listToBeScrapedWithInterval: FunctionReference<
        "query",
        "internal",
        { limit: number; minIntervalMs?: number },
        any,
        Name
      >;
      toggleScraping: FunctionReference<
        "mutation",
        "internal",
        { id: string },
        any,
        Name
      >;
      updateLastScrapedAt: FunctionReference<
        "mutation",
        "internal",
        { id: string; lastScrapedAt: number },
        any,
        Name
      >;
      updateUsername: FunctionReference<
        "mutation",
        "internal",
        { id: string; username: string },
        any,
        Name
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
        any,
        Name
      >;
    };
  };
