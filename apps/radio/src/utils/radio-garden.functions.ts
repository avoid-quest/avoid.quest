// Import from subpath to avoid pulling in incompatible deps (cheerio etc.)
import {
  getRadioGardenSuggestions,
  type RadioGardenSearchResult,
  resolveRadioGardenStream as resolveStream,
  searchRadioGarden,
} from "@avoid.quest/platforms/radiogarden/search";
// biome-ignore lint/performance/noNamespaceImport: namespace import required for Sentry
import * as Sentry from "@sentry/tanstackstart-react";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { rateLimitMiddleware } from "./middleware";

// ============================================
// Radio Garden Search
// ============================================

const RadioGardenSearchSchema = z.object({
  query: z.string().min(1, "Search query is required").max(200),
});

export type RadioGardenSearchResponse =
  | { success: true; results: RadioGardenSearchResult[] }
  | { success: false; error: string };

export const radioGardenSearch = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("radio-garden-search")])
  .inputValidator(RadioGardenSearchSchema)
  .handler(async ({ data }): Promise<RadioGardenSearchResponse> => {
    try {
      const results = await searchRadioGarden(data.query);
      return { success: true, results };
    } catch (error) {
      Sentry.captureException(error);
      const errorMessage =
        error instanceof Error ? error.message : "Search failed";
      return { success: false, error: errorMessage };
    }
  });

// ============================================
// Radio Garden Stream Resolution
// ============================================

const RadioGardenResolveSchema = z.object({
  channelId: z
    .string()
    .min(1, "Channel ID is required")
    .regex(/^[a-zA-Z0-9]+$/, "Invalid channel ID format"),
});

export type RadioGardenResolveResponse =
  | { success: true; streamUrl: string }
  | { success: false; error: string };

export const radioGardenResolveStream = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("radio-garden-resolve")])
  .inputValidator(RadioGardenResolveSchema)
  .handler(async ({ data }): Promise<RadioGardenResolveResponse> => {
    try {
      const streamUrl = await resolveStream(data.channelId);
      return { success: true, streamUrl };
    } catch (error) {
      Sentry.captureException(error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to resolve stream";
      return { success: false, error: errorMessage };
    }
  });

// ============================================
// Radio Garden Suggestions (Popular Stations)
// ============================================

export type RadioGardenSuggestionsResponse =
  | { success: true; results: RadioGardenSearchResult[] }
  | { success: false; error: string };

export const radioGardenSuggestions = createServerFn({ method: "GET" })
  .middleware([rateLimitMiddleware("radio-garden-suggestions")])
  .handler(async (): Promise<RadioGardenSuggestionsResponse> => {
    try {
      const results = await getRadioGardenSuggestions();
      return { success: true, results };
    } catch (error) {
      Sentry.captureException(error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to fetch suggestions";
      return { success: false, error: errorMessage };
    }
  });
