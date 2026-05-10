/**
 * SoundCloud Search API
 *
 * Uses the SoundCloud API v2 to search for tracks.
 */

export type SoundCloudSearchResult = {
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  url: string;
  duration: number; // seconds
};

type SoundCloudSearchApiTrack = {
  id: number;
  title: string;
  permalink_url: string;
  artwork_url?: string;
  duration: number; // milliseconds
  user?: {
    username: string;
    avatar_url?: string;
  };
  media?: {
    transcodings?: unknown[];
  };
};

type SoundCloudSearchApiResponse = {
  collection: SoundCloudSearchApiTrack[];
  total_results?: number;
  next_href?: string;
};

const SEARCH_TIMEOUT_MS = 10_000;

/**
 * Get high-res artwork URL from SoundCloud's image URL
 */
function getHighResArtwork(url?: string): string | undefined {
  if (!url) {
    return;
  }
  return url.replace("-large", "-t500x500");
}

/**
 * Search SoundCloud for tracks.
 *
 * @param query - Search query string
 * @param clientId - SoundCloud client ID (required)
 * @param limit - Maximum results to return (default 20)
 */
export async function searchSoundCloud(
  query: string,
  clientId: string,
  limit = 20
): Promise<SoundCloudSearchResult[]> {
  const url = new URL("https://api-v2.soundcloud.com/search/tracks");
  url.searchParams.set("q", query);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`SoundCloud search failed: ${response.statusText}`);
  }

  const data = (await response.json()) as SoundCloudSearchApiResponse;
  const tracks = data.collection ?? [];

  // Filter to only playable tracks (have transcodings)
  return tracks
    .filter((track) => track.media?.transcodings?.length)
    .map((track) => ({
      id: String(track.id),
      title: track.title,
      artist: track.user?.username || "Unknown Artist",
      thumbnail: getHighResArtwork(track.artwork_url || track.user?.avatar_url),
      url: track.permalink_url,
      duration: Math.floor(track.duration / 1000),
    }));
}
