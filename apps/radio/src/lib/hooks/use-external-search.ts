import {
  type SearchPlatform,
  transformBandcampResults,
  transformRadioGardenResults,
  transformSoundCloudResults,
  transformYouTubeResults,
  type UnifiedSearchResult,
} from "@avoid.quest/platforms";
// biome-ignore lint/performance/noNamespaceImport: namespace import required for Sentry
import * as Sentry from "@sentry/tanstackstart-react";
import { useMutation } from "@tanstack/react-query";
import { radioGardenSearch } from "@/utils/radio-garden.functions";
import { bandcampSearch, soundcloudSearch } from "@/utils/search.functions";
import { youtubeSearch } from "@/utils/youtube.functions";

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

async function searchRadioGardenPlatform(
  query: string
): Promise<UnifiedSearchResult[]> {
  const response = await radioGardenSearch({ data: { query } });
  if (!response.success) {
    throw new Error(response.error);
  }
  return transformRadioGardenResults(response.results);
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
  const [
    bandcampResults,
    radioGardenResults,
    soundcloudResults,
    youtubeResults,
  ] = await Promise.allSettled([
    searchBandcampPlatform(query, "t"), // Tracks only for "all" search
    searchRadioGardenPlatform(query),
    searchSoundCloudPlatform(query),
    searchYouTubePlatform(query, "songs"),
  ]);

  const settled = [
    { name: "bandcamp", result: bandcampResults },
    { name: "radiogarden", result: radioGardenResults },
    { name: "soundcloud", result: soundcloudResults },
    { name: "youtube", result: youtubeResults },
  ] as const;

  for (const { name, result } of settled) {
    if (result.status === "rejected") {
      Sentry.captureException(result.reason, {
        tags: { searchPlatform: name },
      });
    }
  }

  const results: UnifiedSearchResult[] = [];

  // Collect successful results
  if (bandcampResults.status === "fulfilled") {
    results.push(...bandcampResults.value);
  }
  if (radioGardenResults.status === "fulfilled") {
    results.push(...radioGardenResults.value);
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
    radiogarden: results.filter((r) => r.platform === "radiogarden"),
    soundcloud: results.filter((r) => r.platform === "soundcloud"),
    youtube: results.filter((r) => r.platform === "youtube"),
  };

  const maxPerRound = 8;
  for (let i = 0; i < maxPerRound; i++) {
    if (byPlatform.bandcamp[i]) {
      interleaved.push(byPlatform.bandcamp[i]);
    }
    if (byPlatform.radiogarden[i]) {
      interleaved.push(byPlatform.radiogarden[i]);
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
        case "radiogarden":
          return await searchRadioGardenPlatform(query);
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
