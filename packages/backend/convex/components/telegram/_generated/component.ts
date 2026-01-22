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
        },
        Name
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
        { error?: string; messageId?: number; success: boolean },
        Name
      >;
      verifyBotToken: FunctionReference<
        "action",
        "internal",
        { botToken: string },
        { botUsername?: string; error?: string; success: boolean },
        Name
      >;
    };
  };
