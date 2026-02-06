import { env } from "cloudflare:workers";
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
      // Pass Invidious config from Cloudflare env
      const invidiousOptions = {
        instanceUrl: env.INVIDIOUS_INSTANCE_URL || undefined,
        auth: env.INVIDIOUS_AUTH || undefined,
      };
      const results = await searchYouTubeMusic(
        data.query,
        data.filter,
        invidiousOptions
      );
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

type ResolveStreamResult = {
  streamUrl: string;
} | null;

export const youtubeResolveStream = createServerFn({ method: "POST" })
  .middleware([rateLimitMiddleware("youtube-resolve-stream")])
  .inputValidator(ResolveStreamSchema)
  .handler(async ({ data }): Promise<{ stream: ResolveStreamResult }> => {
    // Pass Invidious config from Cloudflare env
    const invidiousOptions = {
      instanceUrl: env.INVIDIOUS_INSTANCE_URL || undefined,
      auth: env.INVIDIOUS_AUTH || undefined,
    };
    const streamUrl = await resolveStreamUrl(data.videoId, invidiousOptions);
    if (!streamUrl) {
      return { stream: null };
    }
    return { stream: { streamUrl } };
  });
