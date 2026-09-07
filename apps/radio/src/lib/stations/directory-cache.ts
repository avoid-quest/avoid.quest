import {
  getRadioBrowserStations,
  type RadioBrowserStation,
  searchRadioBrowser,
} from "@avoid.quest/platforms/radiobrowser";
import {
  getRadioGardenMetadata,
  resolveRadioGardenStream,
  searchRadioGarden,
} from "@avoid.quest/platforms/radiogarden/search";
import {
  cacheMetadata,
  DIRECTORY_SEARCH_TTL,
  type MetadataStore,
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

export async function searchCachedRadioBrowser(
  store: MetadataStore,
  query: string,
  limit: number
) {
  let retrieved: RadioBrowserStation[] | undefined;
  const stations = await cacheMetadata({
    key: ["radio-browser", "search-v2", query, limit],
    retrieve: async () => {
      retrieved = await searchRadioBrowser(query, { limit });
      return retrieved.map((station) =>
        hasPublicPlaybackUrl(station.url) &&
        hasPublicPlaybackUrl(station.urlResolved)
          ? station
          : { ...station, url: "", urlResolved: "" }
      );
    },
    store,
    ttl: DIRECTORY_SEARCH_TTL,
  });
  if (retrieved) {
    return retrieved;
  }
  const refresh = stations.filter(
    (station) => !(station.url || station.urlResolved)
  );
  if (refresh.length === 0) {
    return stations;
  }
  // Keep search metadata shared without persisting expiring/session URLs.
  const fresh = new Map(
    (
      await getRadioBrowserStations(
        refresh.map((station) => station.stationUuid)
      )
    ).map((station) => [station.stationUuid, station])
  );
  return stations.flatMap((station) => {
    if (station.url || station.urlResolved) {
      return [station];
    }
    const playback = fresh.get(station.stationUuid);
    return playback
      ? [{ ...station, url: playback.url, urlResolved: playback.urlResolved }]
      : [];
  });
}

export function searchCachedRadioGarden(store: MetadataStore, query: string) {
  return cacheMetadata({
    key: ["radio-garden", "search", query],
    retrieve: () => searchRadioGarden(query),
    store,
    ttl: DIRECTORY_SEARCH_TTL,
  });
}

export async function getCachedRadioGardenItem(
  store: MetadataStore,
  channelId: string
) {
  const result = await cacheMetadata({
    key: ["radio-garden", "station", channelId],
    retrieve: () => getRadioGardenMetadata(channelId),
    shouldCache: (value) => value.success,
    store,
    ttl: STATION_METADATA_TTL,
  });
  return result.success
    ? { ...result, streamUrl: await resolveRadioGardenStream(channelId) }
    : result;
}
