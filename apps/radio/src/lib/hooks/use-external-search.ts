import { captureError } from "@avoid.quest/error";
import type { UnifiedSearchResult } from "@avoid.quest/platforms";
import { useMutation } from "@tanstack/react-query";
import {
  createExternalPlatformSearchWorkflow,
  type ExternalPlatformSearchParams,
} from "@/lib/external-platform-search-workflow";
import { createConfiguredResolverBroker } from "@/lib/resolver";
import { getConfiguredYouTubeClient } from "@/lib/youtube";

type SearchParams = ExternalPlatformSearchParams;

const externalPlatformSearchWorkflow = createExternalPlatformSearchWorkflow({
  adapters: {
    bandcamp: {
      search: async (query, filter) =>
        await createConfiguredResolverBroker().search({
          filter,
          provider: "bandcamp",
          query,
        }),
    },
    radiogarden: {
      search: async (query) =>
        await createConfiguredResolverBroker().search({
          provider: "radiogarden",
          query,
        }),
    },
    soundcloud: {
      search: async (query) =>
        await createConfiguredResolverBroker().search({
          provider: "soundcloud",
          query,
        }),
    },
    youtube: {
      search: async (query, filter) =>
        await getConfiguredYouTubeClient().search(query, filter),
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
