import { waitUntil } from "cloudflare:workers";
import { edgeMetadataCache, type MetadataCache } from "./cache";

// Timed-out writes remain alive after the response returns.
export const workerMetadataCache: MetadataCache = {
  get: (key, type) => edgeMetadataCache.get(key, type),
  put: (key, value, options) => {
    const write = edgeMetadataCache.put(key, value, options);
    waitUntil(write);
    return write;
  },
};
