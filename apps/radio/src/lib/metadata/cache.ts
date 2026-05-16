import type { RadioMetadataResponse } from "./types";

type CacheEntry = {
  expiresAt: number;
  response: RadioMetadataResponse;
};

const MAX_CACHE_ENTRIES = 256;
const cache = new Map<string, CacheEntry>();

export const RADIO_METADATA_SUCCESS_TTL_MS = 15_000;
export const RADIO_METADATA_UNSUPPORTED_TTL_MS = 10_000;
export const RADIO_METADATA_FAILURE_TTL_MS = 5000;

export function getRadioMetadataCacheKey(streamUrl: string): string {
  return new URL(streamUrl).toString();
}

export function getCachedRadioMetadata(
  key: string,
  now = Date.now()
): RadioMetadataResponse | null {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return cached.response;
}

export function setCachedRadioMetadata(
  key: string,
  response: RadioMetadataResponse,
  ttlMs: number,
  now = Date.now()
): void {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, {
    expiresAt: now + ttlMs,
    response,
  });
}

export function clearRadioMetadataCache(): void {
  cache.clear();
}
