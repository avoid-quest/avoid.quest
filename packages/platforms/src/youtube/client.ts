import {
  type YouTubeProviderAdapter,
  YouTubeProviderAggregateError,
  YouTubeProviderError,
  type YouTubeProviderSearchFilter,
} from "./provider.js";
import type { YouTubeItemResult, YouTubeSearchResult } from "./types.js";

export type YouTubeClient = {
  readonly providers: readonly YouTubeProviderAdapter[];
  resolveItem: (
    url: string,
    signal?: AbortSignal
  ) => Promise<YouTubeItemResult>;
  resolveStream: (videoId: string, signal?: AbortSignal) => Promise<string>;
  search: (
    query: string,
    filter?: YouTubeProviderSearchFilter,
    signal?: AbortSignal
  ) => Promise<YouTubeSearchResult[]>;
};

function normalizeProviderError(
  provider: YouTubeProviderAdapter,
  error: unknown
): YouTubeProviderError {
  if (error instanceof YouTubeProviderError) {
    return error;
  }
  return new YouTubeProviderError("YouTube provider failed", {
    cause: error,
    code: "network-or-cors",
    kind: provider.kind,
    providerId: provider.id,
  });
}

function runWithFailover<T>(
  providers: readonly YouTubeProviderAdapter[],
  operation: (provider: YouTubeProviderAdapter) => Promise<T>
): Promise<T> {
  const errors: YouTubeProviderError[] = [];
  const runProvider = async (providerIndex: number): Promise<T> => {
    const provider = providers[providerIndex];
    if (!provider) {
      throw new YouTubeProviderAggregateError(errors);
    }

    try {
      return await operation(provider);
    } catch (error) {
      const providerError = normalizeProviderError(provider, error);
      if (!providerError.retryable) {
        throw providerError;
      }
      errors.push(providerError);
      return runProvider(providerIndex + 1);
    }
  };

  return runProvider(0);
}

export function createYouTubeClient(
  providers: readonly YouTubeProviderAdapter[]
): YouTubeClient {
  if (providers.length === 0) {
    throw new TypeError("At least one YouTube provider is required");
  }
  const configuredProviders = [...providers];
  return {
    providers: configuredProviders,
    resolveItem: async (url, signal) =>
      await runWithFailover(configuredProviders, (provider) =>
        provider.resolveItem(url, signal)
      ),
    resolveStream: async (videoId, signal) =>
      await runWithFailover(configuredProviders, (provider) =>
        provider.resolveStream(videoId, signal)
      ),
    search: async (query, filter, signal) =>
      await runWithFailover(configuredProviders, (provider) =>
        provider.search(query, filter ?? "songs", signal)
      ),
  };
}
