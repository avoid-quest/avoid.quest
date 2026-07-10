import { validatePublicHttpUrl } from "../url-policy/public-http-url.js";
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

function normalizeStation(
  station: RadioBrowserStationResponse
): RadioBrowserStation | null {
  const normalized = {
    stationUuid: asString(station.stationuuid),
    name: asString(station.name),
    url: asSafeHttpUrl(station.url),
    urlResolved: asSafeHttpUrl(station.url_resolved),
    homepage: asSafeHttpUrl(station.homepage),
    favicon: asSafeHttpUrl(station.favicon),
    country: asString(station.country),
    state: asString(station.state),
    tags: asTags(station.tags),
    codec: asString(station.codec),
    bitrate: asBitrate(station.bitrate),
    hls: asBoolean(station.hls),
    lastCheckOk: asBoolean(station.lastcheckok),
    lastCheckTime: asString(station.lastchecktime),
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
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const discoveredServers =
    options.servers === undefined
      ? await discoverServers(fetchImpl, options.signal, timeoutMs)
      : uniqueServerUrls(options.servers);
  const servers = randomize(discoveredServers, options.random ?? Math.random);
  if (servers.length === 0) {
    throw new Error("Radio Browser returned no valid HTTPS servers");
  }

  let lastError: unknown = null;
  for (const server of servers) {
    throwIfAborted(options.signal);
    try {
      const payload = await fetchJson(
        createSearchUrl(server, normalizedQuery, normalizeLimit(options.limit)),
        fetchImpl,
        options.signal,
        timeoutMs
      );
      if (!Array.isArray(payload)) {
        throw new Error("Radio Browser returned an invalid station list");
      }
      return payload
        .filter(
          (station): station is RadioBrowserStationResponse =>
            typeof station === "object" && station !== null
        )
        .map(normalizeStation)
        .filter((station): station is RadioBrowserStation => station !== null);
    } catch (error) {
      throwIfAborted(options.signal);
      lastError = error;
    }
  }

  throw new Error("Radio Browser search failed on every discovered server", {
    cause: lastError,
  });
}
