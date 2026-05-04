import { captureError } from "@avoid.quest/error";
import type {
  SearchPlatform,
  UnifiedSearchResult,
} from "@avoid.quest/platforms";
import { useMutation } from "@tanstack/react-query";
import { createExternalPlatformSearchWorkflow } from "@/lib/external-platform-search-workflow";
import { radioGardenSearch } from "@/utils/radio-garden.functions";
import { bandcampSearch, soundcloudSearch } from "@/utils/search.functions";
import { youtubeSearch } from "@/utils/youtube.functions";

type SearchParams = {
  query: string;
  platform: SearchPlatform;
  bandcampFilter?: "" | "t" | "a";
  youtubeFilter?: "songs" | "videos";
};

const externalPlatformSearchWorkflow = createExternalPlatformSearchWorkflow({
  adapters: {
    bandcamp: {
      search: async (query, filter) => {
        const response = await bandcampSearch({ data: { query, filter } });
        if (!response.ok) {
          throw new Error(response.error.message);
        }
        return response.data.results;
      },
    },
    radiogarden: {
      search: async (query) => {
        const response = await radioGardenSearch({ data: { query } });
        if (!response.ok) {
          throw new Error(response.error.message);
        }
        return response.data.results;
      },
    },
    soundcloud: {
      search: async (query) => {
        const response = await soundcloudSearch({ data: { query } });
        if (!response.ok) {
          throw new Error(response.error.message);
        }
        return response.data.results;
      },
    },
    youtube: {
      search: async (query, filter) => {
        const response = await youtubeSearch({ data: { query, filter } });
        if (!response.ok) {
          throw new Error(response.error.message);
        }
        return response.data.results;
      },
    },
  },
  reportProviderError: (provider, error) => {
    captureError(error, {
      surface: "ui",
      operation: "searchAllPlatforms",
      tags: { searchPlatform: provider },
    });
  },
});

export function useExternalSearch() {
  return useMutation({
    mutationFn: async ({
      query,
      platform,
      bandcampFilter,
      youtubeFilter,
    }: SearchParams): Promise<UnifiedSearchResult[]> => {
      return await externalPlatformSearchWorkflow.search({
        bandcampFilter,
        platform,
        query,
        youtubeFilter,
      });
    },
  });
}
