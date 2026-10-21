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

/** Adapters receive the search's abort signal so they can cancel their requests. */
export type ExternalPlatformSearchAdapters = {
  bandcamp: {
    search: (
      query: string,
      filter: BandcampSearchFilter,
      signal?: AbortSignal
    ) => Promise<BandcampSearchResult[]>;
  };
  /**
   * Optional until every app wires Mixcloud: without it, "all" skips
   * Mixcloud and a Mixcloud-only search rejects.
   */
  mixcloud?: {
    search: (
      query: string,
      signal?: AbortSignal
    ) => Promise<MixcloudSearchResult[]>;
  };
  radiogarden: {
    search: (
      query: string,
      signal?: AbortSignal
    ) => Promise<RadioGardenSearchResult[]>;
  };
  soundcloud: {
    search: (
      query: string,
      signal?: AbortSignal
    ) => Promise<SoundCloudSearchResult[]>;
  };
  youtube: {
    search: (
      query: string,
      filter: YouTubeSearchFilter,
      signal?: AbortSignal
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

/** Settles with the abort reason as soon as `signal` aborts, even if `operation` ignores it. */
function untilAborted<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (!signal) {
    return operation;
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
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

  function searchProvider(
    provider: SearchablePlatform,
    query: string,
    params: ProviderSearchParams,
    signal: AbortSignal | undefined
  ): Promise<UnifiedSearchResult[]> {
    // Never start a provider request for a search that is already cancelled.
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    return untilAborted(callProvider(provider, query, params, signal), signal);
  }

  async function callProvider(
    provider: SearchablePlatform,
    query: string,
    params: ProviderSearchParams,
    signal: AbortSignal | undefined
  ): Promise<UnifiedSearchResult[]> {
    switch (provider) {
      case "bandcamp":
        return transformBandcampResults(
          await adapters.bandcamp.search(
            query,
            params.bandcampFilter ?? "",
            signal
          )
        );
      case "mixcloud": {
        if (!adapters.mixcloud) {
          throw new Error("Mixcloud search is not configured");
        }
        return transformMixcloudResults(
          await adapters.mixcloud.search(query, signal)
        );
      }
      case "radiogarden":
        return transformRadioGardenResults(
          await adapters.radiogarden.search(query, signal)
        );
      case "soundcloud":
        return transformSoundCloudResults(
          await adapters.soundcloud.search(query, signal)
        );
      case "youtube":
        return transformYouTubeResults(
          await adapters.youtube.search(
            query,
            params.youtubeFilter ?? "songs",
            signal
          )
        );
      default: {
        const _exhaustive: never = provider;
        throw new Error(`Unsupported search provider: ${_exhaustive}`);
      }
    }
  }

  async function searchAllInterleaved(
    query: string,
    signal: AbortSignal | undefined
  ): Promise<UnifiedSearchResult[]> {
    const providerResults = await Promise.all(
      allProviders.map(async (provider): Promise<ProviderSearchResult> => {
        try {
          return {
            provider,
            results: await searchProvider(
              provider,
              query,
              resolvedAllProviderSearchParams[provider],
              signal
            ),
            status: "fulfilled",
          };
        } catch (error) {
          return { error, provider, status: "rejected" };
        }
      })
    );
    signal?.throwIfAborted();

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
    query: string,
    signal: AbortSignal | undefined
  ): Promise<UnifiedSearchResult[]> {
    const results: UnifiedSearchResult[] = [];

    await Promise.all(
      allProviders.map((provider) =>
        searchProvider(
          provider,
          query,
          resolvedAllProviderSearchParams[provider],
          signal
        )
          .then((providerResults) => {
            results.push(...providerResults);
          })
          .catch((error) => {
            if (!signal?.aborted) {
              reportProviderError?.(provider, error);
            }
          })
      )
    );
    signal?.throwIfAborted();

    return results;
  }

  function searchAll(
    query: string,
    signal: AbortSignal | undefined
  ): Promise<UnifiedSearchResult[]> {
    if (allProviderResultsMode === "append-by-completion") {
      return searchAllByCompletion(query, signal);
    }
    return searchAllInterleaved(query, signal);
  }

  return {
    /**
     * Aborting `signal` rejects with its reason right away, cancels pending
     * adapter requests, and is never reported as a provider failure.
     */
    search(
      params: ExternalPlatformSearchParams,
      signal?: AbortSignal
    ): Promise<UnifiedSearchResult[]> {
      if (signal?.aborted) {
        return Promise.reject(signal.reason);
      }
      const query = params.query.trim();
      if (!query) {
        return Promise.resolve([]);
      }

      if (params.platform === "all") {
        return searchAll(query, signal);
      }

      return searchProvider(params.platform, query, params, signal).catch(
        (error: unknown) => {
          if (signal?.aborted) {
            throw signal.reason;
          }
          reportProviderError?.(params.platform as SearchablePlatform, error);
          throw error;
        }
      );
    },
  };
}
