import {
  fetchPublicHttpUrlWithValidatedRedirects,
  type PublicHttpFetchResult,
  type PublicHttpRedirectFailure,
} from "@avoid.quest/platforms/url-policy";
import { createBoundedRangeHeader } from "./stream-limits";

export type StreamAccessMode = "direct" | "proxy" | "rejected";
export type StreamRedirectFailure = PublicHttpRedirectFailure;
export type StreamRedirectFailureDetails = {
  reason: StreamRedirectFailure;
  url: string;
};
export type StreamAccessDecision =
  | { mode: "direct"; response: null; resolvedUrl: string | null }
  | { mode: "proxy"; response: Response | null; resolvedUrl: null }
  | {
      failure: StreamRedirectFailureDetails;
      mode: "rejected";
      response: null;
      resolvedUrl: null;
    };

type StreamAccessCacheEntry = {
  expiresAt: number;
  mode: Exclude<StreamAccessMode, "rejected">;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type DetermineStreamAccessOptions = {
  fetchImpl?: FetchLike;
  now?: () => number;
  origin: string;
  requestHeaders?: Headers;
  timeoutMs?: number;
};

const STREAM_ACCESS_CACHE_TTL_MS = 10 * 60 * 1000;
const STREAM_ACCESS_PROBE_TIMEOUT_MS = 4000;
const STREAM_ACCESS_MAX_REDIRECTS = 5;
const STREAM_ACCESS_MAX_RANGE_BYTES = 8 * 1024 * 1024;

const streamAccessCache = new Map<string, StreamAccessCacheEntry>();

function normalizeAccessControlOrigin(value: string): string {
  return value.trim().toLowerCase();
}

function getStreamAccessCacheKey(url: string, origin: string): string {
  return `${normalizeAccessControlOrigin(origin)}::${url}`;
}

function isCorsPlayableForOrigin(
  accessControlAllowOrigin: string | null,
  origin: string
): boolean {
  if (!accessControlAllowOrigin) {
    return false;
  }

  const normalizedOrigin = normalizeAccessControlOrigin(
    accessControlAllowOrigin
  );
  return (
    normalizedOrigin === "*" ||
    normalizedOrigin === normalizeAccessControlOrigin(origin)
  );
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (!response.body) {
    return;
  }

  try {
    await response.body.cancel();
  } catch {
    // Some runtimes lock the body stream once headers are available.
  }
}

export function fetchPublicStreamWithRedirects(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
  maxRedirects = STREAM_ACCESS_MAX_REDIRECTS
): Promise<PublicHttpFetchResult> {
  return fetchPublicHttpUrlWithValidatedRedirects({
    fetchImpl,
    init,
    maxRedirects,
    url,
  });
}

async function probeStreamAccess(
  url: string,
  {
    fetchImpl = fetch,
    now = Date.now,
    origin,
    requestHeaders,
    timeoutMs = STREAM_ACCESS_PROBE_TIMEOUT_MS,
  }: DetermineStreamAccessOptions,
  preserveProxyResponse: boolean
): Promise<StreamAccessDecision> {
  const cacheKey = getStreamAccessCacheKey(url, origin);
  const cached = streamAccessCache.get(cacheKey);
  const currentTime = now();
  // Direct stream inspections can emit browser redirects, so they need a
  // freshly validated redirect chain instead of a cached mode-only decision.
  const canUseCachedDecision =
    cached &&
    cached.expiresAt > currentTime &&
    (cached.mode !== "direct" || !preserveProxyResponse);

  if (canUseCachedDecision) {
    return {
      mode: cached.mode,
      response: null,
      resolvedUrl: null,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const headers: HeadersInit = {
      "Icy-MetaData": requestHeaders?.get("Icy-MetaData") || "0",
    };

    const rangeResult = createBoundedRangeHeader(
      requestHeaders?.get("range") ?? null,
      STREAM_ACCESS_MAX_RANGE_BYTES
    );
    if (rangeResult.ok && rangeResult.range) {
      headers.Range = rangeResult.range;
    } else if (!preserveProxyResponse) {
      headers.Range = "bytes=0-0";
    }

    const fetchResult = await fetchPublicStreamWithRedirects(
      url,
      {
        headers,
        method: "GET",
        signal: controller.signal,
      },
      fetchImpl
    );
    if (!fetchResult.ok) {
      streamAccessCache.delete(cacheKey);
      return {
        failure: fetchResult.failure,
        mode: "rejected",
        response: null,
        resolvedUrl: null,
      };
    }

    const { response, resolvedUrl } = fetchResult;

    const mode = isCorsPlayableForOrigin(
      response.headers.get("access-control-allow-origin"),
      origin
    )
      ? "direct"
      : "proxy";

    streamAccessCache.set(cacheKey, {
      expiresAt: currentTime + STREAM_ACCESS_CACHE_TTL_MS,
      mode,
    });

    if (mode === "direct" || !preserveProxyResponse) {
      await cancelResponseBody(response);
    }

    if (mode === "direct") {
      return {
        mode,
        response: null,
        resolvedUrl,
      };
    }

    return {
      mode,
      response: preserveProxyResponse ? response : null,
      resolvedUrl: null,
    };
  } catch {
    streamAccessCache.set(cacheKey, {
      expiresAt: currentTime + STREAM_ACCESS_CACHE_TTL_MS,
      mode: "proxy",
    });
    return {
      mode: "proxy",
      response: null,
      resolvedUrl: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function determineStreamAccessMode(
  url: string,
  options: DetermineStreamAccessOptions
): Promise<StreamAccessMode> {
  const result = await probeStreamAccess(url, options, false);
  return result.mode;
}

export function inspectStreamAccess(
  url: string,
  options: DetermineStreamAccessOptions
): Promise<StreamAccessDecision> {
  return probeStreamAccess(url, options, true);
}

export function clearStreamAccessCache(): void {
  streamAccessCache.clear();
}
