import type { RadioMetadataResponse } from "./types";

type CacheEntry = {
  expiresAt: number;
  response: RadioMetadataResponse;
};

const MAX_CACHE_ENTRIES = 256;
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<RadioMetadataResponse>>();

export const RADIO_METADATA_SUCCESS_TTL_MS = 60_000;
export const RADIO_METADATA_UNSUPPORTED_TTL_MS = 10_000;
export const RADIO_METADATA_FAILURE_TTL_MS = 5000;
export const EPISODE_METADATA_TTL = 6 * 60 * 60;
export const STATION_METADATA_TTL = 24 * 60 * 60;
export const DIRECTORY_SEARCH_TTL = 10 * 60;

export type MetadataStore = {
  get: <T>(key: string, type: "json") => Promise<T | null>;
  put: (
    key: string,
    value: string,
    options: { expirationTtl: number }
  ) => Promise<void>;
};

// Give each best-effort cache operation a bounded chance to finish.
const METADATA_CACHE_TIMEOUT_MS = 500;

async function waitForCache<T>(operation: Promise<T>): Promise<T | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(
          () => resolve(undefined),
          METADATA_CACHE_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function cacheMetadata<T>({
  store,
  key,
  ttl,
  retrieve,
  now = Date.now,
  shouldCache = (value) => value !== null,
  expiresAt,
}: {
  store?: MetadataStore;
  key: readonly unknown[];
  ttl: number;
  retrieve: () => Promise<T>;
  now?: () => number;
  shouldCache?: (value: T) => boolean;
  expiresAt?: (value: T) => number;
}): Promise<T> {
  if (!store) {
    return retrieve();
  }
  // Hash every argument so cache keys contain no provider URLs or queries.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(key))
  );
  const cacheKey = `metadata:v1:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
  try {
    const entry = await waitForCache(
      store.get<{ value: T; expiresAt: number }>(cacheKey, "json")
    );
    if (entry && entry.expiresAt > now()) {
      return entry.value;
    }
  } catch {
    // Cache availability must not prevent provider retrieval.
  }
  const sampledAt = now();
  const value = await retrieve();
  const deadline = expiresAt?.(value) ?? sampledAt + ttl * 1000;
  if (shouldCache(value) && deadline > now()) {
    try {
      await waitForCache(
        store.put(cacheKey, JSON.stringify({ expiresAt: deadline, value }), {
          // Logical expiry also handles snapshots sampled before this lookup.
          expirationTtl: Math.max(60, Math.ceil((deadline - now()) / 1000)),
        })
      );
    } catch {
      // A failed or competing write must not discard valid provider data.
    }
  }
  return value;
}

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

export function getOrSetCachedRadioMetadata(
  key: string,
  options: {
    now?: () => number;
    retrieve: () => Promise<RadioMetadataResponse>;
    ttlForResponse: (response: RadioMetadataResponse) => number;
  }
): Promise<RadioMetadataResponse> {
  const now = options.now ?? Date.now;
  const cached = getCachedRadioMetadata(key, now());
  if (cached) {
    return Promise.resolve(cached);
  }

  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const pending = options
    .retrieve()
    .then((response) => {
      setCachedRadioMetadata(
        key,
        response,
        options.ttlForResponse(response),
        now()
      );
      return response;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, pending);
  return pending;
}

export function clearRadioMetadataCache(): void {
  cache.clear();
  inFlight.clear();
}
