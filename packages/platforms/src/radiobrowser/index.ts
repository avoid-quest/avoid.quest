import {
  cachePublicHostnameResolver,
  type PublicHostnameResolver,
  resolvePublicHostnameWithDoh,
  validatePublicHttpUrl,
  validateResolvedPublicHttpUrl,
} from "../url-policy/public-http-url.js";
import type {
  RadioBrowserFetch,
  RadioBrowserSearchOptions,
  RadioBrowserStation,
} from "./types.js";

export type {
  RadioBrowserFetch,
  RadioBrowserSearchOptions,
  RadioBrowserStation,
} from "./types.js";

const DISCOVERY_URL = "https://all.api.radio-browser.info/json/servers";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const SERVER_CACHE_TTL_MS = 10 * 60 * 1000;

let serverCache: { expiresAt: number; servers: string[] } | null = null;

type RadioBrowserServer = { name?: unknown };
type RadioBrowserStationResponse = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asSafeHttpUrl(value: unknown): string {
  const url = asString(value).trim();
  const validation = validatePublicHttpUrl(url);
  if (
    !validation.ok ||
    validation.parsed.username ||
    validation.parsed.password
  ) {
    return "";
  }
  return url;
}

function asSafeHttpsUrl(value: unknown): string {
  const url = asSafeHttpUrl(value);
  return url && new URL(url).protocol === "https:" ? url : "";
}

async function asSafeResolvedHttpsUrl(
  value: unknown,
  resolveHostname: PublicHostnameResolver | false,
  signal?: AbortSignal
): Promise<string> {
  const url = asSafeHttpsUrl(value);
  if (!url) {
    return "";
  }
  const validation = await validateResolvedPublicHttpUrl(url, {
    resolveHostname,
    signal,
  });
  return validation.ok ? url : "";
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function asBitrate(value: unknown): number {
  const bitrate = typeof value === "number" ? value : Number(value);
  return Number.isFinite(bitrate) && bitrate >= 0 ? bitrate : 0;
}

function asTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return asString(value)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function normalizeStation(
  station: RadioBrowserStationResponse,
  resolveHostname: PublicHostnameResolver | false,
  signal?: AbortSignal
): Promise<RadioBrowserStation | null> {
  const canonicalUrl = asSafeHttpsUrl(station.url);
  const urlResolved = await asSafeResolvedHttpsUrl(
    station.url_resolved,
    resolveHostname,
    signal
  );
  const url = urlResolved
    ? canonicalUrl
    : await asSafeResolvedHttpsUrl(canonicalUrl, resolveHostname, signal);
  const normalized = {
    bitrate: asBitrate(station.bitrate),
    codec: asString(station.codec),
    country: asString(station.country),
    favicon: asSafeHttpUrl(station.favicon),
    hls: asBoolean(station.hls),
    homepage: asSafeHttpUrl(station.homepage),
    lastCheckOk: asBoolean(station.lastcheckok),
    lastCheckTime: asString(station.lastchecktime),
    name: asString(station.name),
    state: asString(station.state),
    stationUuid: asString(station.stationuuid),
    tags: asTags(station.tags),
    url,
    urlResolved,
  } satisfies RadioBrowserStation;

  if (
    !(
      normalized.stationUuid &&
      normalized.name &&
      (normalized.urlResolved || normalized.url)
    )
  ) {
    return null;
  }

  return normalized;
}

function isOfficialServerHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "api.radio-browser.info" ||
    normalized.endsWith(".api.radio-browser.info")
  );
}

function normalizeServerUrl(
  server: string,
  requireOfficialHostname: boolean
): string | null {
  try {
    const url = new URL(server.includes("://") ? server : `https://${server}`);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (requireOfficialHostname && !isOfficialServerHostname(url.hostname))
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function uniqueServerUrls(
  servers: readonly string[],
  requireOfficialHostname = false
): string[] {
  return [
    ...new Set(
      servers
        .map((server) => normalizeServerUrl(server, requireOfficialHostname))
        .filter((server): server is string => server !== null)
    ),
  ];
}

function randomize<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [
      result[swapIndex] as T,
      result[index] as T,
    ];
  }
  return result;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Request aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

function createTimeoutSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number
): { cleanup: () => void; signal: AbortSignal } {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(parent ? abortReason(parent) : undefined);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) {
    abort();
  }
  const timeout = setTimeout(
    () =>
      controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs
  );
  return {
    cleanup: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abort);
    },
    signal: controller.signal,
  };
}

function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

async function fetchJson(
  url: URL | string,
  fetchImpl: RadioBrowserFetch,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<unknown> {
  throwIfAborted(signal);

  const controller = new AbortController();
  const abort = () =>
    controller.abort(signal ? abortReason(signal) : undefined);
  signal?.addEventListener("abort", abort, { once: true });
  const timeoutId = setTimeout(
    () =>
      controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs
  );

  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Radio Browser request failed: ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abort);
  }
}

async function discoverServers(
  fetchImpl: RadioBrowserFetch,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<string[]> {
  if (serverCache && serverCache.expiresAt > Date.now()) {
    return serverCache.servers;
  }

  try {
    const payload = await fetchJson(
      DISCOVERY_URL,
      fetchImpl,
      signal,
      timeoutMs
    );
    if (!Array.isArray(payload)) {
      throw new Error("Radio Browser returned an invalid server list");
    }

    const servers = uniqueServerUrls(
      payload
        .map((server: RadioBrowserServer) => server.name)
        .filter((name): name is string => typeof name === "string"),
      true
    );
    if (servers.length === 0) {
      throw new Error("Radio Browser returned no valid HTTPS servers");
    }
    serverCache = {
      expiresAt: Date.now() + SERVER_CACHE_TTL_MS,
      servers,
    };
    return servers;
  } catch (error) {
    if (serverCache) {
      return serverCache.servers;
    }
    throw error;
  }
}

function createSearchUrl(server: string, query: string, limit: number): URL {
  const url = new URL("/json/stations/search", server);
  url.searchParams.set("name", query);
  url.searchParams.set("hidebroken", "true");
  url.searchParams.set("is_https", "true");
  url.searchParams.set("order", "clickcount");
  url.searchParams.set("reverse", "true");
  url.searchParams.set("limit", String(limit));
  return url;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit as number)));
}

export async function searchRadioBrowser(
  query: string,
  options: RadioBrowserSearchOptions = {}
): Promise<RadioBrowserStation[]> {
  const normalizedQuery = query.trim().slice(0, 200);
  if (!normalizedQuery) {
    return [];
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveHostname =
    options.resolveHostname ??
    (fetchImpl === globalThis.fetch ? resolvePublicHostnameWithDoh : false);
  const cachedResolveHostname =
    resolveHostname === false
      ? false
      : cachePublicHostnameResolver(resolveHostname);
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const discoveredServers =
    options.servers === undefined
      ? await discoverServers(fetchImpl, options.signal, timeoutMs)
      : uniqueServerUrls(options.servers);
  const servers = randomize(discoveredServers, options.random ?? Math.random);
  if (servers.length === 0) {
    throw new Error("Radio Browser returned no valid HTTPS servers");
  }

  const searchServer = async (
    serverIndex: number,
    lastError: unknown = null
  ): Promise<RadioBrowserStation[]> => {
    const server = servers[serverIndex];
    if (!server) {
      throw new Error(
        "Radio Browser search failed on every discovered server",
        {
          cause: lastError,
        }
      );
    }

    throwIfAborted(options.signal);
    const requestSignal = createTimeoutSignal(options.signal, timeoutMs);
    try {
      const payload = await fetchJson(
        createSearchUrl(server, normalizedQuery, normalizeLimit(options.limit)),
        fetchImpl,
        requestSignal.signal,
        timeoutMs
      );
      if (!Array.isArray(payload)) {
        throw new Error("Radio Browser returned an invalid station list");
      }
      const stations = await awaitWithSignal(
        Promise.all(
          payload
            .filter(
              (station): station is RadioBrowserStationResponse =>
                typeof station === "object" && station !== null
            )
            .map((station) =>
              normalizeStation(
                station,
                cachedResolveHostname,
                requestSignal.signal
              )
            )
        ),
        requestSignal.signal
      );
      throwIfAborted(options.signal);
      const validStations = stations.filter(
        (station): station is RadioBrowserStation => station !== null
      );
      requestSignal.cleanup();
      return validStations;
    } catch (error) {
      requestSignal.cleanup();
      throwIfAborted(options.signal);
      return searchServer(serverIndex + 1, error);
    }
  };

  return searchServer(0);
}
