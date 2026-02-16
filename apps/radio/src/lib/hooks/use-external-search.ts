import { captureError } from "@avoid.quest/error";
import {
  type SearchPlatform,
  transformBandcampResults,
  transformRadioGardenResults,
  transformSoundCloudResults,
  transformYouTubeResults,
  type UnifiedSearchResult,
} from "@avoid.quest/platforms";
import { useMutation } from "@tanstack/react-query";
import { radioGardenSearch } from "@/utils/radio-garden.functions";
import { bandcampSearch, soundcloudSearch } from "@/utils/search.functions";
import { youtubeSearch } from "@/utils/youtube.functions";

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
  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return transformBandcampResults(response.data.results);
}

async function searchSoundCloudPlatform(
  query: string
): Promise<UnifiedSearchResult[]> {
  const response = await soundcloudSearch({ data: { query } });
  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return transformSoundCloudResults(response.data.results);
}

async function searchRadioGardenPlatform(
  query: string
): Promise<UnifiedSearchResult[]> {
  const response = await radioGardenSearch({ data: { query } });
  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return transformRadioGardenResults(response.data.results);
}

async function searchYouTubePlatform(
  query: string,
  filter: "songs" | "videos" = "songs"
): Promise<UnifiedSearchResult[]> {
  const response = await youtubeSearch({ data: { query, filter } });
  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return transformYouTubeResults(response.data.results);
}

async function searchAllPlatforms(
  query: string
): Promise<UnifiedSearchResult[]> {
  const [
    bandcampResults,
    radioGardenResults,
    soundcloudResults,
    youtubeResults,
  ] = await Promise.allSettled([
    searchBandcampPlatform(query, "t"),
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
      captureError(result.reason, {
        surface: "ui",
        operation: "searchAllPlatforms",
        tags: { searchPlatform: name },
      });
    }
  }

  const results: UnifiedSearchResult[] = [];
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

  for (const platform of Object.values(byPlatform)) {
    interleaved.push(...platform.slice(maxPerRound));
  }

  return interleaved;
}

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
