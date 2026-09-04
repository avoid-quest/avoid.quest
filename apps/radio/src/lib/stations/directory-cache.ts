import { searchRadioBrowser } from "@avoid.quest/platforms/radiobrowser";
import {
  getRadioGardenMetadata,
  resolveRadioGardenStream,
  searchRadioGarden,
} from "@avoid.quest/platforms/radiogarden/search";
import {
  cacheMetadata,
  DIRECTORY_SEARCH_TTL,
  type MetadataKv,
  STATION_METADATA_TTL,
} from "@/lib/metadata/cache";

function hasPublicPlaybackUrl(value: string): boolean {
  if (!value) {
    return true;
  }
  const url = new URL(value);
  // Query-bearing playback URLs may contain expiring signatures or sessions.
  return !(url.search || url.username || url.password);
}

export function searchCachedRadioBrowser(
  kv: MetadataKv,
  query: string,
  limit: number
) {
  return cacheMetadata({
    key: ["radio-browser", "search", query, limit],
    kv,
    retrieve: () => searchRadioBrowser(query, { limit }),
    shouldCache: (stations) =>
      stations.every(
        (station) =>
          hasPublicPlaybackUrl(station.url) &&
          hasPublicPlaybackUrl(station.urlResolved)
      ),
    ttl: DIRECTORY_SEARCH_TTL,
  });
}

export function searchCachedRadioGarden(kv: MetadataKv, query: string) {
  return cacheMetadata({
    key: ["radio-garden", "search", query],
    kv,
    retrieve: () => searchRadioGarden(query),
    ttl: DIRECTORY_SEARCH_TTL,
  });
}

export async function getCachedRadioGardenItem(
  kv: MetadataKv,
  channelId: string
) {
  const result = await cacheMetadata({
    key: ["radio-garden", "station", channelId],
    kv,
    retrieve: () => getRadioGardenMetadata(channelId),
    shouldCache: (value) => value.success,
    ttl: STATION_METADATA_TTL,
  });
  return result.success
    ? { ...result, streamUrl: await resolveRadioGardenStream(channelId) }
    : result;
}
