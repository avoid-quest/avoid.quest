// Import from subpath to avoid pulling in incompatible deps (cheerio etc.)
import { type AppResult, runServerFn } from "@avoid.quest/error";
import {
  type RadioGardenSearchResult,
  resolveRadioGardenStream,
  searchRadioGarden,
} from "@avoid.quest/platforms/radiogarden/search";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { rateLimitMiddleware } from "./middleware";

const RadioGardenSearchSchema = z.object({
  query: z.string().min(1, "Search query is required").max(200),
});

const RADIO_GARDEN_SEARCH_LIMIT = 10;

const RadioGardenStreamSchema = z.object({
  channelId: z
    .string()
    .min(1, "Channel ID is required")
    .max(100)
    .regex(/^[\w-]+$/, "Invalid Radio Garden channel ID"),
});

export type RadioGardenSearchCandidate = RadioGardenSearchResult & {
  streamUrl: string;
};

export type RadioGardenSearchResponse = AppResult<{
  results: RadioGardenSearchCandidate[];
}>;

export const radioGardenSearch = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("radio-garden-search")])
  .validator(RadioGardenSearchSchema)
  .handler(
    ({ data }): Promise<RadioGardenSearchResponse> =>
      runServerFn({
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
          const candidates = await Promise.all(
            results.slice(0, RADIO_GARDEN_SEARCH_LIMIT).map(async (result) => {
              try {
                return {
                  ...result,
                  streamUrl: await resolveRadioGardenStream(result.channelId),
                };
              } catch {
                return null;
              }
            })
          );
          return {
            results: candidates.filter(
              (candidate): candidate is RadioGardenSearchCandidate =>
                candidate !== null
            ),
          };
        },
      })
  );

export type RadioGardenStreamResponse = AppResult<{ streamUrl: string }>;

export const radioGardenStream = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("radio-garden-stream")])
  .validator(RadioGardenStreamSchema)
  .handler(
    ({ data }): Promise<RadioGardenStreamResponse> =>
      runServerFn({
        operation: "radioGardenStream",
        fallback: {
          code: "RADIO_GARDEN_STREAM_FAILED",
          safeMessage: "Failed to resolve station stream",
          category: "dependency",
          expected: false,
          status: 500,
        },
        run: async () => ({
          streamUrl: await resolveRadioGardenStream(data.channelId),
        }),
      })
  );
