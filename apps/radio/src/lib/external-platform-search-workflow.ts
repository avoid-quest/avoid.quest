import type {
  BandcampSearchFilter,
  BandcampSearchResult,
  RadioGardenSearchResult,
  SearchPlatform,
  SoundCloudSearchResult,
  UnifiedSearchResult,
  YouTubeSearchResult,
} from "@avoid.quest/platforms";
import {
  transformBandcampResults,
  transformRadioGardenResults,
  transformSoundCloudResults,
  transformYouTubeResults,
} from "@avoid.quest/platforms";

export type ExternalPlatformSearchParams = {
  query: string;
  platform: SearchPlatform;
  bandcampFilter?: "" | "t" | "a";
  youtubeFilter?: "songs" | "videos";
};

export type ExternalPlatformSearchAdapters = {
  bandcamp: {
    search: (
      query: string,
      filter: BandcampSearchFilter
    ) => Promise<BandcampSearchResult[]>;
  };
  radiogarden: {
    search: (query: string) => Promise<RadioGardenSearchResult[]>;
  };
  soundcloud: {
    search: (query: string) => Promise<SoundCloudSearchResult[]>;
  };
  youtube: {
    search: (
      query: string,
      filter: "songs" | "videos"
    ) => Promise<YouTubeSearchResult[]>;
  };
};

type SearchableProvider = Exclude<SearchPlatform, "all">;
type ProviderSearchParams = Pick<
  ExternalPlatformSearchParams,
  "bandcampFilter" | "youtubeFilter"
>;

type ExternalPlatformSearchWorkflowDependencies = {
  adapters: ExternalPlatformSearchAdapters;
  reportProviderError?: (provider: SearchableProvider, error: unknown) => void;
};

type ProviderSearchResult =
  | {
      provider: SearchableProvider;
      results: UnifiedSearchResult[];
      status: "fulfilled";
    }
  | {
      error: unknown;
      provider: SearchableProvider;
      status: "rejected";
    };

const ALL_PROVIDER_ORDER = [
  "bandcamp",
  "radiogarden",
  "soundcloud",
  "youtube",
] as const satisfies SearchableProvider[];

const MAX_INTERLEAVE_ROUNDS = 8;

const ALL_PROVIDER_SEARCH_PARAMS = {
  bandcamp: { bandcampFilter: "t" },
  radiogarden: {},
  soundcloud: {},
  youtube: { youtubeFilter: "songs" },
} as const satisfies Record<SearchableProvider, ProviderSearchParams>;

function interleaveResults(
  resultsByProvider: Record<SearchableProvider, UnifiedSearchResult[]>
): UnifiedSearchResult[] {
  const interleaved: UnifiedSearchResult[] = [];

  for (let index = 0; index < MAX_INTERLEAVE_ROUNDS; index++) {
    for (const provider of ALL_PROVIDER_ORDER) {
      const result = resultsByProvider[provider][index];
      if (result) {
        interleaved.push(result);
      }
    }
  }

  for (const provider of ALL_PROVIDER_ORDER) {
    interleaved.push(
      ...resultsByProvider[provider].slice(MAX_INTERLEAVE_ROUNDS)
    );
  }

  return interleaved;
}

export function createExternalPlatformSearchWorkflow({
  adapters,
  reportProviderError,
}: ExternalPlatformSearchWorkflowDependencies) {
  async function searchProvider(
    provider: SearchableProvider,
    query: string,
    params: ProviderSearchParams
  ): Promise<UnifiedSearchResult[]> {
    switch (provider) {
      case "bandcamp":
        return transformBandcampResults(
          await adapters.bandcamp.search(query, params.bandcampFilter ?? "")
        );
      case "radiogarden":
        return transformRadioGardenResults(
          await adapters.radiogarden.search(query)
        );
      case "soundcloud":
        return transformSoundCloudResults(
          await adapters.soundcloud.search(query)
        );
      case "youtube":
        return transformYouTubeResults(
          await adapters.youtube.search(query, params.youtubeFilter ?? "songs")
        );
      default: {
        const _exhaustive: never = provider;
        throw new Error(`Unsupported search provider: ${_exhaustive}`);
      }
    }
  }

  async function searchAll(query: string): Promise<UnifiedSearchResult[]> {
    const providerResults = await Promise.all(
      ALL_PROVIDER_ORDER.map(
        async (provider): Promise<ProviderSearchResult> => {
          try {
            return {
              provider,
              results: await searchProvider(
                provider,
                query,
                ALL_PROVIDER_SEARCH_PARAMS[provider]
              ),
              status: "fulfilled",
            };
          } catch (error) {
            return { error, provider, status: "rejected" };
          }
        }
      )
    );

    const resultsByProvider: Record<SearchableProvider, UnifiedSearchResult[]> =
      {
        bandcamp: [],
        radiogarden: [],
        soundcloud: [],
        youtube: [],
      };

    for (const result of providerResults) {
      if (result.status === "fulfilled") {
        resultsByProvider[result.provider] = result.results;
      } else {
        reportProviderError?.(result.provider, result.error);
      }
    }

    return interleaveResults(resultsByProvider);
  }

  return {
    search(
      params: ExternalPlatformSearchParams
    ): Promise<UnifiedSearchResult[]> {
      const query = params.query.trim();
      if (!query) {
        return Promise.resolve([]);
      }

      if (params.platform === "all") {
        return searchAll(query);
      }

      return searchProvider(params.platform, query, params);
    },
  };
}
