import type {
  BandcampSearchFilter,
  BandcampSearchResult,
} from "./bandcamp/search.js";
import type { MixcloudSearchResult } from "./mixcloud/search.js";
import type { RadioGardenSearchResult } from "./radiogarden/types.js";
import type { SoundCloudSearchResult } from "./soundcloud/search.js";
import type { YouTubeSearchResult } from "./youtube/types.js";

export type SearchPlatform =
  | "all"
  | "bandcamp"
  | "mixcloud"
  | "radiogarden"
  | "soundcloud"
  | "youtube";

export type SearchResultType =
  | "track"
  | "album"
  | "video"
  | "playlist"
  | "artist"
  | "station"
  | "show";

export type UnifiedSearchResult = {
  id: string;
  platform: "bandcamp" | "mixcloud" | "radiogarden" | "soundcloud" | "youtube";
  type: SearchResultType;
  title: string;
  artist: string;
  thumbnail?: string;
  duration?: number;
  url: string;
  albumTitle?: string;
};

export type UnifiedSearchResponse =
  | { success: true; results: UnifiedSearchResult[] }
  | { success: false; error: string };

export type SearchablePlatform = Exclude<SearchPlatform, "all">;

export type YouTubeSearchFilter = "songs" | "videos";

export type ExternalPlatformSearchParams = {
  query: string;
  platform: SearchPlatform;
  bandcampFilter?: BandcampSearchFilter;
  youtubeFilter?: YouTubeSearchFilter;
};

export type ExternalPlatformSearchAdapters = {
  bandcamp: {
    search: (
      query: string,
      filter: BandcampSearchFilter
    ) => Promise<BandcampSearchResult[]>;
  };
  /**
   * Optional until every app wires Mixcloud: without it, "all" skips
   * Mixcloud and a Mixcloud-only search rejects.
   */
  mixcloud?: {
    search: (query: string) => Promise<MixcloudSearchResult[]>;
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
      filter: YouTubeSearchFilter
    ) => Promise<YouTubeSearchResult[]>;
  };
};

type ProviderSearchParams = Pick<
  ExternalPlatformSearchParams,
  "bandcampFilter" | "youtubeFilter"
>;

type ProviderSearchResult =
  | {
      provider: SearchablePlatform;
      results: UnifiedSearchResult[];
      status: "fulfilled";
    }
  | {
      error: unknown;
      provider: SearchablePlatform;
      status: "rejected";
    };

type AllProviderResultsMode = "append-by-completion" | "interleave";

type ExternalPlatformSearchWorkflowDependencies = {
  adapters: ExternalPlatformSearchAdapters;
  allProviderSearchParams?: Partial<
    Record<SearchablePlatform, ProviderSearchParams>
  >;
  allProviderResultsMode?: AllProviderResultsMode;
  reportProviderError?: (provider: SearchablePlatform, error: unknown) => void;
};

const ALL_PROVIDER_ORDER = [
  "bandcamp",
  "mixcloud",
  "radiogarden",
  "soundcloud",
  "youtube",
] as const satisfies SearchablePlatform[];

const MAX_INTERLEAVE_ROUNDS = 8;

const DEFAULT_ALL_PROVIDER_SEARCH_PARAMS = {
  bandcamp: { bandcampFilter: "t" },
  mixcloud: {},
  radiogarden: {},
  soundcloud: {},
  youtube: { youtubeFilter: "songs" },
} as const satisfies Record<SearchablePlatform, ProviderSearchParams>;

export function transformBandcampResults(
  results: BandcampSearchResult[]
): UnifiedSearchResult[] {
  return results.map((r) => ({
    albumTitle: r.albumTitle,
    artist: r.artist,
    id: `bc-${r.id}`,
    platform: "bandcamp" as const,
    thumbnail: r.thumbnail,
    title: r.title,
    type: r.type,
    url: r.url,
  }));
}

export function transformSoundCloudResults(
  results: SoundCloudSearchResult[]
): UnifiedSearchResult[] {
  return results.map((r) => ({
    artist: r.artist,
    duration: r.duration,
    id: `sc-${r.id}`,
    platform: "soundcloud" as const,
    thumbnail: r.thumbnail,
    title: r.title,
    type: "track" as const,
    url: r.url,
  }));
}

export function transformMixcloudResults(
  results: MixcloudSearchResult[]
): UnifiedSearchResult[] {
  return results.map((r) => ({
    artist: r.artist,
    duration: r.duration,
    id: `mc-${r.id}`,
    platform: "mixcloud" as const,
    thumbnail: r.thumbnail,
    title: r.title,
    type: "show" as const,
    url: r.url,
  }));
}

export function transformYouTubeResults(
  results: YouTubeSearchResult[]
): UnifiedSearchResult[] {
  return results.map((r) => ({
    artist: r.author,
    duration: r.duration,
    id: `yt-${r.videoId}`,
    platform: "youtube" as const,
    thumbnail: r.thumbnail,
    title: r.title,
    type: "video" as const,
    url: `https://youtube.com/watch?v=${r.videoId}`,
  }));
}

export function transformRadioGardenResults(
  results: RadioGardenSearchResult[]
): UnifiedSearchResult[] {
  return results.map((r) => ({
    artist: `${r.placeTitle}, ${r.countryTitle}`,
    id: `rg-${r.channelId}`,
    platform: "radiogarden" as const,
    title: r.title,
    type: "station" as const,
    url: r.url,
  }));
}

function resolveAllProviderSearchParams(
  overrides?: Partial<Record<SearchablePlatform, ProviderSearchParams>>
): Record<SearchablePlatform, ProviderSearchParams> {
  return {
    bandcamp: {
      ...DEFAULT_ALL_PROVIDER_SEARCH_PARAMS.bandcamp,
      ...overrides?.bandcamp,
    },
    mixcloud: {
      ...DEFAULT_ALL_PROVIDER_SEARCH_PARAMS.mixcloud,
      ...overrides?.mixcloud,
    },
    radiogarden: {
      ...DEFAULT_ALL_PROVIDER_SEARCH_PARAMS.radiogarden,
      ...overrides?.radiogarden,
    },
    soundcloud: {
      ...DEFAULT_ALL_PROVIDER_SEARCH_PARAMS.soundcloud,
      ...overrides?.soundcloud,
    },
    youtube: {
      ...DEFAULT_ALL_PROVIDER_SEARCH_PARAMS.youtube,
      ...overrides?.youtube,
    },
  };
}

function createEmptyResultsByProvider(): Record<
  SearchablePlatform,
  UnifiedSearchResult[]
> {
  return {
    bandcamp: [],
    mixcloud: [],
    radiogarden: [],
    soundcloud: [],
    youtube: [],
  };
}

function interleaveResults(
  resultsByProvider: Record<SearchablePlatform, UnifiedSearchResult[]>
): UnifiedSearchResult[] {
  const interleaved: UnifiedSearchResult[] = [];

  for (let index = 0; index < MAX_INTERLEAVE_ROUNDS; index += 1) {
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
  allProviderSearchParams,
  allProviderResultsMode = "interleave",
  reportProviderError,
}: ExternalPlatformSearchWorkflowDependencies) {
  const resolvedAllProviderSearchParams = resolveAllProviderSearchParams(
    allProviderSearchParams
  );
  const allProviders = ALL_PROVIDER_ORDER.filter(
    (provider) => provider !== "mixcloud" || adapters.mixcloud
  );

  async function searchProvider(
    provider: SearchablePlatform,
    query: string,
    params: ProviderSearchParams
  ): Promise<UnifiedSearchResult[]> {
    switch (provider) {
      case "bandcamp":
        return transformBandcampResults(
          await adapters.bandcamp.search(query, params.bandcampFilter ?? "")
        );
      case "mixcloud": {
        if (!adapters.mixcloud) {
          throw new Error("Mixcloud search is not configured");
        }
        return transformMixcloudResults(await adapters.mixcloud.search(query));
      }
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

  async function searchAllInterleaved(
    query: string
  ): Promise<UnifiedSearchResult[]> {
    const providerResults = await Promise.all(
      allProviders.map(async (provider): Promise<ProviderSearchResult> => {
        try {
          return {
            provider,
            results: await searchProvider(
              provider,
              query,
              resolvedAllProviderSearchParams[provider]
            ),
            status: "fulfilled",
          };
        } catch (error) {
          return { error, provider, status: "rejected" };
        }
      })
    );

    const resultsByProvider = createEmptyResultsByProvider();

    for (const result of providerResults) {
      if (result.status === "fulfilled") {
        resultsByProvider[result.provider] = result.results;
      } else {
        reportProviderError?.(result.provider, result.error);
      }
    }

    return interleaveResults(resultsByProvider);
  }

  async function searchAllByCompletion(
    query: string
  ): Promise<UnifiedSearchResult[]> {
    const results: UnifiedSearchResult[] = [];

    await Promise.all(
      allProviders.map((provider) =>
        searchProvider(
          provider,
          query,
          resolvedAllProviderSearchParams[provider]
        )
          .then((providerResults) => {
            results.push(...providerResults);
          })
          .catch((error) => {
            reportProviderError?.(provider, error);
          })
      )
    );

    return results;
  }

  function searchAll(query: string): Promise<UnifiedSearchResult[]> {
    if (allProviderResultsMode === "append-by-completion") {
      return searchAllByCompletion(query);
    }
    return searchAllInterleaved(query);
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
