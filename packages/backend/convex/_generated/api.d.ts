/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as bootstrap from "../bootstrap.js";
import type * as crons from "../crons.js";
import type * as healthCheck from "../healthCheck.js";
import type * as http from "../http.js";
import type * as lib_config_defaults from "../lib/config/defaults.js";
import type * as lib_config_index from "../lib/config/index.js";
import type * as lib_config_validators from "../lib/config/validators.js";
import type * as lib_dateUtils from "../lib/dateUtils.js";
import type * as lib_logger from "../lib/logger.js";
import type * as media_items from "../media_items.js";
import type * as posts from "../posts.js";
import type * as sessions from "../sessions.js";
import type * as settings from "../settings.js";
import type * as telegram_bot from "../telegram/bot.js";
import type * as telegram_handlers_textInput from "../telegram/handlers/textInput.js";
import type * as telegram_lib_storageAdapter from "../telegram/lib/storageAdapter.js";
import type * as telegram_menus_actionsMenu from "../telegram/menus/actionsMenu.js";
import type * as telegram_menus_index from "../telegram/menus/index.js";
import type * as telegram_menus_mainMenu from "../telegram/menus/mainMenu.js";
import type * as telegram_menus_settingsMenu from "../telegram/menus/settingsMenu.js";
import type * as telegram_menus_usersMenu from "../telegram/menus/usersMenu.js";
import type * as telegram_webhook from "../telegram/webhook.js";
import type * as telegram_messages from "../telegram_messages.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  bootstrap: typeof bootstrap;
  crons: typeof crons;
  healthCheck: typeof healthCheck;
  http: typeof http;
  "lib/config/defaults": typeof lib_config_defaults;
  "lib/config/index": typeof lib_config_index;
  "lib/config/validators": typeof lib_config_validators;
  "lib/dateUtils": typeof lib_dateUtils;
  "lib/logger": typeof lib_logger;
  media_items: typeof media_items;
  posts: typeof posts;
  sessions: typeof sessions;
  settings: typeof settings;
  "telegram/bot": typeof telegram_bot;
  "telegram/handlers/textInput": typeof telegram_handlers_textInput;
  "telegram/lib/storageAdapter": typeof telegram_lib_storageAdapter;
  "telegram/menus/actionsMenu": typeof telegram_menus_actionsMenu;
  "telegram/menus/index": typeof telegram_menus_index;
  "telegram/menus/mainMenu": typeof telegram_menus_mainMenu;
  "telegram/menus/settingsMenu": typeof telegram_menus_settingsMenu;
  "telegram/menus/usersMenu": typeof telegram_menus_usersMenu;
  "telegram/webhook": typeof telegram_webhook;
  telegram_messages: typeof telegram_messages;
  users: typeof users;
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
  instagram: {
    fetcher: {
      fetchPost: FunctionReference<
        "action",
        "internal",
        { postUrl: string },
        {
          error?: string;
          post?: {
            caption: string;
            display_url: string;
            id: string;
            is_video: boolean;
            media_items: Array<{
              height?: number;
              type: "image" | "video" | "thumbnail";
              url: string;
              width?: number;
            }>;
            media_type: "image" | "video" | "carousel";
            shortcode: string;
            thumbnail_url?: string;
            timestampSec: number;
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
            display_url: string;
            id: string;
            is_video: boolean;
            media_items: Array<{
              height?: number;
              type: "image" | "video" | "thumbnail";
              url: string;
              width?: number;
            }>;
            media_type: "image" | "video" | "carousel";
            shortcode: string;
            thumbnail_url?: string;
            timestampSec: number;
            url: string;
            video_url?: string;
          }>;
          success: boolean;
        }
      >;
      testConnectivity: FunctionReference<
        "action",
        "internal",
        {},
        { message: string; success: boolean }
      >;
    };
  };
  telegram: {
    sender: {
      sendMessage: FunctionReference<
        "action",
        "internal",
        {
          caption: string;
          chatId: string;
          mediaItems: Array<{
            file_id?: string;
            height?: number;
            type: "image" | "video" | "thumbnail";
            url?: string;
            width?: number;
          }>;
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
        { chatId: string; disableNotification?: boolean; text: string },
        { error?: string; messageId?: number; success: boolean }
      >;
      verifyBotToken: FunctionReference<
        "action",
        "internal",
        {},
        { botUsername?: string; error?: string; success: boolean }
      >;
    };
  };
};
