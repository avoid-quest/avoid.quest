import { type InvidiousOptions, searchInvidious } from "./invidious.js";
import type { YouTubeSearchResult } from "./types.js";

/**
 * Search YouTube Music via Invidious API.
 *
 * @param query - Search query
 * @param filter - "songs" or "videos" (Invidious doesn't distinguish, returns videos)
 * @param options - Optional Invidious instance configuration
 */
export async function searchYouTubeMusic(
  query: string,
  _filter: "songs" | "videos" = "songs",
  options?: InvidiousOptions
): Promise<YouTubeSearchResult[]> {
  const results = await searchInvidious(query, options);

  return results.map((item) => {
    // Format views as string (e.g., "1.2M views")
    const views = item.viewCount > 0 ? formatViews(item.viewCount) : undefined;

    // Get thumbnail URL
    const thumbnail =
      item.videoThumbnails.find((t) => t.quality === "high")?.url ||
      item.videoThumbnails[0]?.url ||
      "";

    // Prepend instance URL for relative thumbnails
    const fullThumbnail = thumbnail.startsWith("/")
      ? `${options?.instanceUrl ?? "https://yt.avoid.quest"}${thumbnail}`
      : thumbnail;

    return {
      author: item.author,
      duration: item.lengthSeconds,
      thumbnail: fullThumbnail,
      title: item.title,
      videoId: item.videoId,
      views,
    };
  });
}

/**
 * Format view count for display (e.g., 1234567 -> "1.2M views")
 */
function formatViews(views: number): string {
  if (views >= 1_000_000_000) {
    return `${(views / 1_000_000_000).toFixed(1)}B views`;
  }
  if (views >= 1_000_000) {
    return `${(views / 1_000_000).toFixed(1)}M views`;
  }
  if (views >= 1000) {
    return `${(views / 1000).toFixed(1)}K views`;
  }
  return `${views} views`;
}
