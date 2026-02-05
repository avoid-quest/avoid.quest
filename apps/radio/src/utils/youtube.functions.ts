import { resolveStreamUrl, searchYouTubeMusic } from "@avoid.quest/youtube";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { YouTubeSearchResponse } from "@/lib/platform-types";
import { rateLimitMiddleware } from "./middleware";

const SearchSchema = z.object({
  query: z.string().min(1, "Search query is required").max(200),
  filter: z.enum(["songs", "videos"]).optional().default("songs"),
});

export const youtubeSearch = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("youtube-search")])
  .inputValidator(SearchSchema)
  .handler(async ({ data }): Promise<YouTubeSearchResponse> => {
    try {
      const results = await searchYouTubeMusic(data.query, data.filter);
      return { success: true, results };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Search failed";
      return { success: false, error: errorMessage };
    }
  });

const ResolveStreamSchema = z.object({
  videoId: z.string().min(1).max(20),
});

export const youtubeResolveStream = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("youtube-resolve-stream")])
  .inputValidator(ResolveStreamSchema)
  .handler(async ({ data }): Promise<{ streamUrl: string | null }> => {
    const streamUrl = await resolveStreamUrl(data.videoId);
    return { streamUrl };
  });
