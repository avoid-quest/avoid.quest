/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as lib_apiClient from "../lib/apiClient.js";
import type * as lib_captionBuilder from "../lib/captionBuilder.js";
import type * as lib_mediaBuilder from "../lib/mediaBuilder.js";
import type * as lib_storageAdapter from "../lib/storageAdapter.js";
import type * as menu_index from "../menu/index.js";
import type * as menu_types from "../menu/types.js";
import type * as sender from "../sender.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  "lib/apiClient": typeof lib_apiClient;
  "lib/captionBuilder": typeof lib_captionBuilder;
  "lib/mediaBuilder": typeof lib_mediaBuilder;
  "lib/storageAdapter": typeof lib_storageAdapter;
  "menu/index": typeof menu_index;
  "menu/types": typeof menu_types;
  sender: typeof sender;
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
