import {
  fetchWithValidatedRedirectResult,
  ValidatedRedirectError,
  type ValidatedRedirectTargetFailure,
  validateRedirectTargetUrl,
} from "@avoid.quest/platforms/redirects";
import {
  type StreamUrlValidationFailure,
  validatePublicStreamUrl,
} from "./url-policy";

export type StreamAccessMode = "direct" | "proxy";
export type StreamAccessDecision = {
  mode: StreamAccessMode;
  response: Response | null;
  resolvedUrl: string | null;
};

type StreamAccessCacheEntry = {
  expiresAt: number;
  mode: StreamAccessMode;
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

const streamAccessCache = new Map<string, StreamAccessCacheEntry>();

export type StreamRedirectFailure =
  ValidatedRedirectTargetFailure<StreamUrlValidationFailure>;

export class StreamRedirectError extends ValidatedRedirectError<StreamRedirectFailure> {
  constructor(reason: StreamRedirectFailure, url: string) {
    super(reason, url);
    this.name = "StreamRedirectError";
  }
}

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

export async function fetchPublicStreamWithRedirects(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
  maxRedirects = STREAM_ACCESS_MAX_REDIRECTS
): Promise<{ response: Response; resolvedUrl: string }> {
  const result = await fetchWithValidatedRedirectResult({
    fetchImpl,
    init,
    invalidUrlReason: "invalid-url",
    maxRedirects,
    url,
    validateUrl: (redirectUrl) =>
      validateRedirectTargetUrl(
        redirectUrl,
        validatePublicStreamUrl,
        "invalid-url"
      ),
  });

  if (!result.ok) {
    throw new StreamRedirectError(result.failure.reason, result.failure.url);
  }

  return {
    response: result.response,
    resolvedUrl: result.resolvedUrl,
  };
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

    const rangeHeader = requestHeaders?.get("range");
    if (rangeHeader) {
      headers.Range = rangeHeader;
    } else if (!preserveProxyResponse) {
      headers.Range = "bytes=0-0";
    }

    const { response, resolvedUrl } = await fetchPublicStreamWithRedirects(
      url,
      {
        headers,
        method: "GET",
        signal: controller.signal,
      },
      fetchImpl
    );

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

    return {
      mode,
      response: mode === "proxy" && preserveProxyResponse ? response : null,
      resolvedUrl: mode === "direct" ? resolvedUrl : null,
    };
  } catch (error) {
    if (error instanceof StreamRedirectError) {
      streamAccessCache.delete(cacheKey);
      throw error;
    }

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
