import { captureError } from "@avoid.quest/error";
import type { UnifiedSearchResult } from "@avoid.quest/platforms";
import { useMutation } from "@tanstack/react-query";
import {
  createExternalPlatformSearchWorkflow,
  type ExternalPlatformSearchParams,
} from "@/lib/external-platform-search-workflow";
import {
  searchBandcamp,
  searchRadioGarden,
  searchSoundCloud,
} from "@/lib/platform-client";
import { getYouTubeClient } from "@/lib/youtube";

type SearchParams = ExternalPlatformSearchParams;

const externalPlatformSearchWorkflow = createExternalPlatformSearchWorkflow({
  adapters: {
    bandcamp: {
      search: searchBandcamp,
    },
    radiogarden: {
      search: searchRadioGarden,
    },
    soundcloud: {
      search: searchSoundCloud,
    },
    youtube: {
      search: async (query, filter) =>
        await getYouTubeClient().search(query, filter),
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
    }: SearchParams): Promise<UnifiedSearchResult[]> =>
      await externalPlatformSearchWorkflow.search({
        bandcampFilter,
        platform,
        query,
        youtubeFilter,
      }),
  });
}
