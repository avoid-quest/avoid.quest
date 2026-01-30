/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adapter from "../adapter.js";
import type * as admin from "../admin.js";
import type * as fetcher from "../fetcher.js";
import type * as lib_rateLimiter from "../lib/rateLimiter.js";
import type * as lib_userAgents from "../lib/userAgents.js";
import type * as lib_validators from "../lib/validators.js";
import type * as mediaItems from "../mediaItems.js";
import type * as posts from "../posts.js";
import type * as settings from "../settings.js";
import type * as telegramMessages from "../telegramMessages.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  adapter: typeof adapter;
  admin: typeof admin;
  fetcher: typeof fetcher;
  "lib/rateLimiter": typeof lib_rateLimiter;
  "lib/userAgents": typeof lib_userAgents;
  "lib/validators": typeof lib_validators;
  mediaItems: typeof mediaItems;
  posts: typeof posts;
  settings: typeof settings;
  telegramMessages: typeof telegramMessages;
  users: typeof users;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
