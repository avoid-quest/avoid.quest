/**
 * Mixcloud Search API
 *
 * Uses the public, keyless REST API at api.mixcloud.com to search shows.
 */

import { isMixcloudShowUrl } from "./detect.js";

export type MixcloudSearchResult = {
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  url: string;
  duration?: number; // seconds
};

type MixcloudApiPictures = {
  extra_large?: string;
  large?: string;
  medium?: string;
};

type MixcloudApiCloudcast = {
  key?: string;
  url?: string;
  name?: string;
  audio_length?: number;
  pictures?: MixcloudApiPictures;
  user?: { name?: string; username?: string };
};

type MixcloudSearchApiResponse = {
  data?: MixcloudApiCloudcast[];
};

const SEARCH_TIMEOUT_MS = 10_000;
const EDGE_SLASHES_PATTERN = /^\/+|\/+$/g;

export function toMixcloudSearchResult(
  cloudcast: MixcloudApiCloudcast
): MixcloudSearchResult | null {
  const { key, url, name, pictures } = cloudcast;
  if (!(key && url && name && isMixcloudShowUrl(url))) {
    return null;
  }

  return {
    artist:
      cloudcast.user?.name || cloudcast.user?.username || "Unknown Artist",
    duration: cloudcast.audio_length,
    id: key.replace(EDGE_SLASHES_PATTERN, ""),
    thumbnail: pictures?.extra_large ?? pictures?.large ?? pictures?.medium,
    title: name,
    url,
  };
}

/**
 * Search Mixcloud for shows.
 *
 * @param query - Search query string
 * @param limit - Maximum results to return (default 20)
 */
export async function searchMixcloud(
  query: string,
  limit = 20
): Promise<MixcloudSearchResult[]> {
  const url = new URL("https://api.mixcloud.com/search/");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "cloudcast");
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Mixcloud search failed: ${response.statusText}`);
  }

  const data = (await response.json()) as MixcloudSearchApiResponse;
  return (data.data ?? [])
    .map(toMixcloudSearchResult)
    .filter((result): result is MixcloudSearchResult => result !== null);
}
