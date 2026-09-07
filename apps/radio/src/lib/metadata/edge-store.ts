import type { MetadataStore } from "./cache";

export function createMetadataEdgeStore(
  requestUrl: () => string,
  openCache: () => Promise<Pick<Cache, "match" | "put">> = () =>
    caches.open("radio-metadata-v1")
): MetadataStore {
  const cacheUrl = (key: string) =>
    new URL(`/__radio_metadata_cache/${encodeURIComponent(key)}`, requestUrl())
      .href;

  return {
    async get<T>(key: string): Promise<T | null> {
      const url = cacheUrl(key);
      const response = await (await openCache()).match(url);
      return response ? response.json<T>() : null;
    },
    async put(key, value, { expirationTtl }) {
      const url = cacheUrl(key);
      await (await openCache()).put(
        url,
        new Response(value, {
          headers: {
            "Cache-Control": `public, max-age=${expirationTtl}`,
            "Content-Type": "application/json",
          },
        })
      );
    },
  };
}
