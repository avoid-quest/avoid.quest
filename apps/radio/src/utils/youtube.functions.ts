import { env } from "cloudflare:workers";
import { type AppResult, runServerFn } from "@avoid.quest/error";
import { resolveStreamUrl, searchYouTubeMusic } from "@avoid.quest/platforms";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { YouTubeSearchResult } from "@/lib/platform-types";
import { readInvidiousOptions } from "./invidious-env";
import { rateLimitMiddleware } from "./middleware";

const SearchSchema = z.object({
  query: z.string().min(1, "Search query is required").max(200),
  filter: z.enum(["songs", "videos"]).optional().default("songs"),
});

export type YouTubeSearchResponse = AppResult<{
  results: YouTubeSearchResult[];
}>;

export const youtubeSearch = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("youtube-search")])
  .validator(SearchSchema)
  .handler(
    ({ data }): Promise<YouTubeSearchResponse> =>
      runServerFn({
        operation: "youtubeSearch",
        fallback: {
          code: "YOUTUBE_SEARCH_FAILED",
          safeMessage: "Search failed",
          category: "dependency",
          expected: false,
          status: 500,
        },
        run: async () => {
          const invidiousOptions = readInvidiousOptions(env);

          const results = await searchYouTubeMusic(
            data.query,
            data.filter,
            invidiousOptions
          );

          return { results };
        },
      })
  );

const ResolveStreamSchema = z.object({
  videoId: z.string().min(1).max(20),
});

type ResolveStreamResult = {
  streamUrl: string;
} | null;

export type YouTubeResolveStreamResponse = AppResult<{
  stream: ResolveStreamResult;
}>;

export const youtubeResolveStream = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("youtube-resolve-stream")])
  .validator(ResolveStreamSchema)
  .handler(
    ({ data }): Promise<YouTubeResolveStreamResponse> =>
      runServerFn({
        operation: "youtubeResolveStream",
        fallback: {
          code: "YOUTUBE_RESOLVE_STREAM_FAILED",
          safeMessage: "Failed to resolve stream",
          category: "dependency",
          expected: false,
          status: 500,
        },
        run: async () => {
          const invidiousOptions = readInvidiousOptions(env);
          const streamUrl = await resolveStreamUrl(
            data.videoId,
            invidiousOptions
          );
          if (!streamUrl) {
            return { stream: null };
          }
          return { stream: { streamUrl } };
        },
      })
  );
