// Import from subpath to avoid pulling in incompatible deps (cheerio etc.)
import { type AppResult, runServerFn } from "@avoid.quest/error";
import {
  getRadioGardenSuggestions,
  type RadioGardenSearchResult,
  resolveRadioGardenStream as resolveStream,
  searchRadioGarden,
} from "@avoid.quest/platforms/radiogarden/search";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { rateLimitMiddleware } from "./middleware";

const RadioGardenSearchSchema = z.object({
  query: z.string().min(1, "Search query is required").max(200),
});

export type RadioGardenSearchResponse = AppResult<{
  results: RadioGardenSearchResult[];
}>;

export const radioGardenSearch = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("radio-garden-search")])
  .inputValidator(RadioGardenSearchSchema)
  .handler(({ data }): Promise<RadioGardenSearchResponse> => {
    return runServerFn({
      operation: "radioGardenSearch",
      fallback: {
        code: "RADIO_GARDEN_SEARCH_FAILED",
        safeMessage: "Search failed",
        category: "dependency",
        expected: false,
        status: 500,
      },
      run: async () => {
        const results = await searchRadioGarden(data.query);
        return { results };
      },
    });
  });

const RadioGardenResolveSchema = z.object({
  channelId: z
    .string()
    .min(1, "Channel ID is required")
    .regex(/^[a-zA-Z0-9]+$/, "Invalid channel ID format"),
});

export type RadioGardenResolveResponse = AppResult<{
  streamUrl: string;
}>;

export const radioGardenResolveStream = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("radio-garden-resolve")])
  .inputValidator(RadioGardenResolveSchema)
  .handler(({ data }): Promise<RadioGardenResolveResponse> => {
    return runServerFn({
      operation: "radioGardenResolveStream",
      fallback: {
        code: "RADIO_GARDEN_RESOLVE_FAILED",
        safeMessage: "Failed to resolve stream",
        category: "dependency",
        expected: false,
        status: 500,
      },
      run: async () => {
        const streamUrl = await resolveStream(data.channelId);
        return { streamUrl };
      },
    });
  });

export type RadioGardenSuggestionsResponse = AppResult<{
  results: RadioGardenSearchResult[];
}>;

export const radioGardenSuggestions = createServerFn({ method: "GET" })
  .middleware([rateLimitMiddleware("radio-garden-suggestions")])
  .handler((): Promise<RadioGardenSuggestionsResponse> => {
    return runServerFn({
      operation: "radioGardenSuggestions",
      fallback: {
        code: "RADIO_GARDEN_SUGGESTIONS_FAILED",
        safeMessage: "Failed to fetch suggestions",
        category: "dependency",
        expected: false,
        status: 500,
      },
      run: async () => {
        const results = await getRadioGardenSuggestions();
        return { results };
      },
    });
  });
