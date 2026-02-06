import type { BandcampSearchResult } from "@avoid.quest/bandcamp";
import type { SoundCloudSearchResult } from "@avoid.quest/soundcloud";
import type { YouTubeSearchResult } from "@avoid.quest/youtube";
import { useMutation } from "@tanstack/react-query";
import type { SearchPlatform, UnifiedSearchResult } from "@/lib/search-types";
import { bandcampSearch, soundcloudSearch } from "@/utils/search.functions";
import { youtubeSearch } from "@/utils/youtube.functions";

// ============================================
// Result Transformers
// ============================================

function transformBandcampResults(
  results: BandcampSearchResult[]
): UnifiedSearchResult[] {
  return results.map((r) => ({
    id: `bc-${r.id}`,
    platform: "bandcamp" as const,
    type: r.type,
    title: r.title,
    artist: r.artist,
    thumbnail: r.thumbnail,
    url: r.url,
    albumTitle: r.albumTitle,
  }));
}

function transformSoundCloudResults(
  results: SoundCloudSearchResult[]
): UnifiedSearchResult[] {
  return results.map((r) => ({
    id: `sc-${r.id}`,
    platform: "soundcloud" as const,
    type: "track" as const,
    title: r.title,
    artist: r.artist,
    thumbnail: r.thumbnail,
    duration: r.duration,
    url: r.url,
  }));
}

function transformYouTubeResults(
  results: YouTubeSearchResult[]
): UnifiedSearchResult[] {
  return results.map((r) => ({
    id: `yt-${r.videoId}`,
    platform: "youtube" as const,
    type: "video" as const,
    title: r.title,
    artist: r.author,
    thumbnail: r.thumbnail,
    duration: r.duration,
    url: `https://youtube.com/watch?v=${r.videoId}`,
  }));
}

// ============================================
// Search Functions
// ============================================

type SearchParams = {
  query: string;
  platform: SearchPlatform;
  bandcampFilter?: "" | "t" | "a";
  youtubeFilter?: "songs" | "videos";
};

async function searchBandcampPlatform(
  query: string,
  filter: "" | "t" | "a" = ""
): Promise<UnifiedSearchResult[]> {
  const response = await bandcampSearch({ data: { query, filter } });
  if (!response.success) {
    throw new Error(response.error);
  }
  return transformBandcampResults(response.results);
}

async function searchSoundCloudPlatform(
  query: string
): Promise<UnifiedSearchResult[]> {
  const response = await soundcloudSearch({ data: { query } });
  if (!response.success) {
    throw new Error(response.error);
  }
  return transformSoundCloudResults(response.results);
}

async function searchYouTubePlatform(
  query: string,
  filter: "songs" | "videos" = "songs"
): Promise<UnifiedSearchResult[]> {
  const response = await youtubeSearch({ data: { query, filter } });
  if (!response.success) {
    throw new Error(response.error);
  }
  return transformYouTubeResults(response.results);
}

async function searchAllPlatforms(
  query: string
): Promise<UnifiedSearchResult[]> {
  // Search all platforms in parallel
  const [bandcampResults, soundcloudResults, youtubeResults] =
    await Promise.allSettled([
      searchBandcampPlatform(query, "t"), // Tracks only for "all" search
      searchSoundCloudPlatform(query),
      searchYouTubePlatform(query, "songs"),
    ]);

  const results: UnifiedSearchResult[] = [];

  // Collect successful results
  if (bandcampResults.status === "fulfilled") {
    results.push(...bandcampResults.value);
  }
  if (soundcloudResults.status === "fulfilled") {
    results.push(...soundcloudResults.value);
  }
  if (youtubeResults.status === "fulfilled") {
    results.push(...youtubeResults.value);
  }

  // Interleave results from different platforms for variety
  // Take first 8 from each platform then append rest
  const interleaved: UnifiedSearchResult[] = [];
  const byPlatform = {
    bandcamp: results.filter((r) => r.platform === "bandcamp"),
    soundcloud: results.filter((r) => r.platform === "soundcloud"),
    youtube: results.filter((r) => r.platform === "youtube"),
  };

  const maxPerRound = 8;
  for (let i = 0; i < maxPerRound; i++) {
    if (byPlatform.bandcamp[i]) {
      interleaved.push(byPlatform.bandcamp[i]);
    }
    if (byPlatform.soundcloud[i]) {
      interleaved.push(byPlatform.soundcloud[i]);
    }
    if (byPlatform.youtube[i]) {
      interleaved.push(byPlatform.youtube[i]);
    }
  }

  // Add remaining results
  for (const platform of Object.values(byPlatform)) {
    interleaved.push(...platform.slice(maxPerRound));
  }

  return interleaved;
}

// ============================================
// Hook
// ============================================

export function useExternalSearch() {
  return useMutation({
    mutationFn: async ({
      query,
      platform,
      bandcampFilter,
      youtubeFilter,
    }: SearchParams): Promise<UnifiedSearchResult[]> => {
      if (!query.trim()) {
        return [];
      }

      switch (platform) {
        case "all":
          return await searchAllPlatforms(query);
        case "bandcamp":
          return await searchBandcampPlatform(query, bandcampFilter);
        case "soundcloud":
          return await searchSoundCloudPlatform(query);
        case "youtube":
          return await searchYouTubePlatform(query, youtubeFilter);
        default:
          return [];
      }
    },
  });
}
