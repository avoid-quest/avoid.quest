import { parseRadioTitle } from "./title-parser";
import type { RadioMetadataSource, RadioNowPlaying } from "./types";
import { RadioMetadataValidationError } from "./upstream-fetch";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const AZURACAST_LISTEN_PATH_PATTERN = /\/listen\/([^/]+)/;
const INTEGER_FIELD_PATTERN = /^\d+$/;

export type ExternalMetadataProviderInput = {
  fetchImpl: FetchLike;
  streamUrl: string;
  sampledAt: number;
  expiresAt: number;
};

type AirtimeTrack = {
  name?: unknown;
  metadata?: {
    artist_name?: unknown;
    track_title?: unknown;
    album_title?: unknown;
    genre?: unknown;
    artwork_url?: unknown;
    url?: unknown;
    info_url?: unknown;
    audio_source_url?: unknown;
    buy_this_url?: unknown;
  };
};

type AirtimeLiveInfo = {
  tracks?: { current?: AirtimeTrack };
  current?: AirtimeTrack;
  shows?: { current?: AirtimeShow | AirtimeShow[] };
  currentShow?: AirtimeShow | AirtimeShow[];
};

type AirtimeShow = {
  name?: unknown;
  description?: unknown;
  image_path?: unknown;
  url?: unknown;
};

type BlackoutListening = {
  title?: unknown;
  excerpt?: unknown;
  featured_media?: unknown;
  link?: unknown;
};

type AzuraCastNowPlaying = {
  station?: {
    name?: unknown;
    description?: unknown;
    listen_url?: unknown;
  };
  now_playing?: {
    song?: {
      artist?: unknown;
      title?: unknown;
      album?: unknown;
      text?: unknown;
      art?: unknown;
      genre?: unknown;
    };
  };
  live?: {
    streamer_name?: unknown;
  };
};

type ShoutcastStatus = {
  songtitle?: unknown;
  currenttitle?: unknown;
  title?: unknown;
  servertitle?: unknown;
  servergenre?: unknown;
  bitrate?: unknown;
};

type Link = {
  href?: unknown;
  rel?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asPublicUrl(value: unknown): string | null {
  const text = asString(value);
  if (!text) {
    return null;
  }
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function shouldPropagateFetchError(error: unknown): boolean {
  return isAbortError(error) || error instanceof RadioMetadataValidationError;
}

async function findSequential<T, TResult>(
  items: readonly T[],
  resolve: (item: T) => Promise<TResult | null>,
  index = 0
): Promise<TResult | null> {
  const item = items[index];
  if (item === undefined) {
    return null;
  }
  const result = await resolve(item);
  return result ?? findSequential(items, resolve, index + 1);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function first<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function buildNowPlaying(input: {
  streamUrl: string;
  resolvedUrl?: string;
  source: RadioMetadataSource;
  rawTitle: string;
  album?: string | null;
  artworkUrl?: string | null;
  itemUrl?: string | null;
  stationName?: string | null;
  stationDescription?: string | null;
  genre?: string | null;
  bitrate?: number | null;
  sampledAt: number;
  expiresAt: number;
}): RadioNowPlaying | null {
  const parsed = parseRadioTitle(input.rawTitle);
  if (!(parsed.title || parsed.artist)) {
    return null;
  }

  return {
    album: input.album ?? null,
    artist: parsed.artist,
    artworkUrl: input.artworkUrl ?? null,
    bitrate: input.bitrate ?? null,
    expiresAt: input.expiresAt,
    genre: input.genre ?? null,
    itemUrl: input.itemUrl ?? null,
    rawTitle: parsed.rawTitle,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: input.source,
    stationDescription: input.stationDescription ?? null,
    stationName: input.stationName ?? null,
    streamUrl: input.streamUrl,
    title: parsed.title,
  };
}

function getSygmaEpisodeUrl(streamUrl: string, slug: unknown): string | null {
  if (new URL(streamUrl).hostname !== "radio.syg.ma") {
    return null;
  }
  const episodeSlug = asString(slug);
  return episodeSlug
    ? new URL(`/episodes/${episodeSlug}`, "https://radio.syg.ma").toString()
    : null;
}

function getAirtimeItemUrl(input: {
  streamUrl: string;
  metadata: AirtimeTrack["metadata"] | undefined;
  show: AirtimeShow | undefined;
}): string | null {
  return (
    asPublicUrl(input.metadata?.url) ??
    getSygmaEpisodeUrl(input.streamUrl, input.metadata?.info_url) ??
    asPublicUrl(input.metadata?.audio_source_url) ??
    asPublicUrl(input.metadata?.buy_this_url) ??
    asPublicUrl(input.show?.url)
  );
}

function normalizeAirtimeLiveInfo(input: {
  data: AirtimeLiveInfo;
  streamUrl: string;
  resolvedUrl?: string;
  sampledAt: number;
  expiresAt: number;
}): RadioNowPlaying | null {
  const track = input.data.tracks?.current ?? input.data.current;
  const show = first(input.data.shows?.current ?? input.data.currentShow);
  const metadata = track?.metadata;
  const artist = asString(metadata?.artist_name);
  const title = asString(metadata?.track_title) ?? asString(track?.name);
  const showName = asString(show?.name);
  const rawTitle =
    [artist, title].filter(Boolean).join(" - ") || title || showName;
  if (!rawTitle) {
    return null;
  }

  return buildNowPlaying({
    album: asString(metadata?.album_title),
    artworkUrl: asString(metadata?.artwork_url) ?? asString(show?.image_path),
    expiresAt: input.expiresAt,
    genre: asString(metadata?.genre),
    itemUrl: getAirtimeItemUrl({
      metadata,
      show,
      streamUrl: input.streamUrl,
    }),
    rawTitle,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "airtime-live-info",
    stationDescription: asString(show?.description),
    streamUrl: input.streamUrl,
  });
}

function getAirtimeCandidateUrls(streamUrl: string): string[] {
  const url = new URL(streamUrl);
  const urls = [
    new URL("/api/live-info-v2", url.origin).toString(),
    new URL("/api/live-info", url.origin).toString(),
  ];

  if (url.hostname === "radio.syg.ma") {
    urls.unshift(new URL("/stats-icecast.json", url.origin).toString());
  }
  if (url.hostname === "cashmereradio.out.airtime.pro") {
    urls.unshift(
      "https://cashmereradio.airtime.pro/api/live-info-v2",
      "https://cashmereradio.airtime.pro/api/live-info"
    );
  }

  return [...new Set(urls)];
}

async function fetchObjectJson(
  fetchImpl: FetchLike,
  url: string
): Promise<{ data: object; response: Response } | null> {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    method: "GET",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  try {
    const data = (await response.json()) as unknown;
    return data && typeof data === "object" ? { data, response } : null;
  } catch {
    return null;
  }
}

async function fetchText(
  fetchImpl: FetchLike,
  url: string,
  accept = "text/plain, */*"
): Promise<{ text: string; response: Response } | null> {
  const response = await fetchImpl(url, {
    headers: { Accept: accept },
    method: "GET",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  try {
    const text = await response.text();
    return text.trim() ? { response, text } : null;
  } catch {
    return null;
  }
}

function getAzuraCastCandidateUrls(streamUrl: string): string[] {
  const url = new URL(streamUrl);
  const stationFromPath = url.pathname.match(
    AZURACAST_LISTEN_PATH_PATTERN
  )?.[1];
  const urls: string[] = [];
  if (stationFromPath) {
    urls.push(
      new URL(`/api/nowplaying/${stationFromPath}`, url.origin).toString()
    );
  }
  urls.push(new URL("/api/nowplaying", url.origin).toString());
  return [...new Set(urls)];
}

function azuraCastStationMatchesStream(
  station: AzuraCastNowPlaying,
  streamPath: string,
  options: { allowMissingListenUrl?: boolean } = {}
): boolean {
  const listenUrl = asString(station.station?.listen_url);
  if (!listenUrl) {
    return options.allowMissingListenUrl ?? false;
  }
  try {
    return new URL(listenUrl).pathname === streamPath;
  } catch {
    return listenUrl.includes(streamPath);
  }
}

function selectAzuraCastStation(
  data: object,
  streamUrl: string
): AzuraCastNowPlaying | null {
  const streamPath = new URL(streamUrl).pathname;
  if (!Array.isArray(data)) {
    const station = data as AzuraCastNowPlaying;
    return azuraCastStationMatchesStream(station, streamPath, {
      allowMissingListenUrl: true,
    })
      ? station
      : null;
  }

  return (
    (data.find((item) =>
      azuraCastStationMatchesStream(item as AzuraCastNowPlaying, streamPath)
    ) as AzuraCastNowPlaying | undefined) ?? null
  );
}

function normalizeAzuraCastNowPlaying(input: {
  data: object;
  streamUrl: string;
  resolvedUrl?: string;
  sampledAt: number;
  expiresAt: number;
}): RadioNowPlaying | null {
  const station = selectAzuraCastStation(input.data, input.streamUrl);
  const song = station?.now_playing?.song;
  const artist = asString(song?.artist);
  const title = asString(song?.title);
  const rawTitle =
    [artist, title].filter(Boolean).join(" - ") || asString(song?.text);
  if (!rawTitle) {
    return null;
  }

  return buildNowPlaying({
    album: asString(song?.album),
    artworkUrl: asString(song?.art),
    expiresAt: input.expiresAt,
    genre: asString(song?.genre),
    rawTitle,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "azuracast-now-playing",
    stationDescription:
      asString(station?.station?.description) ??
      asString(station?.live?.streamer_name),
    stationName: asString(station?.station?.name),
    streamUrl: input.streamUrl,
  });
}

export async function tryAzuraCastNowPlaying(
  input: ExternalMetadataProviderInput,
  endpoint?: string
): Promise<RadioNowPlaying | null> {
  const urls = endpoint
    ? [endpoint]
    : getAzuraCastCandidateUrls(input.streamUrl);
  return await findSequential([...new Set(urls)], async (url) => {
    let result: Awaited<ReturnType<typeof fetchObjectJson>>;
    try {
      result = await fetchObjectJson(input.fetchImpl, url);
    } catch (error) {
      if (shouldPropagateFetchError(error)) {
        throw error;
      }
      return null;
    }
    return result
      ? normalizeAzuraCastNowPlaying({
          data: result.data,
          expiresAt: input.expiresAt,
          resolvedUrl: result.response.url || url,
          sampledAt: input.sampledAt,
          streamUrl: input.streamUrl,
        })
      : null;
  });
}

function getShoutcastCandidateUrls(streamUrl: string, sid = "1"): string[] {
  const { origin } = new URL(streamUrl);
  return [
    new URL(`/stats?sid=${sid}&json=1`, origin).toString(),
    new URL(`/currentsong?sid=${sid}`, origin).toString(),
    new URL(`/7.html?sid=${sid}`, origin).toString(),
  ];
}

function normalizeShoutcastJson(input: {
  data: object;
  streamUrl: string;
  resolvedUrl?: string;
  sampledAt: number;
  expiresAt: number;
}): RadioNowPlaying | null {
  const data = input.data as ShoutcastStatus;
  const rawTitle =
    asString(data.songtitle) ??
    asString(data.currenttitle) ??
    asString(data.title);
  if (!rawTitle) {
    return null;
  }
  return buildNowPlaying({
    bitrate: asNumber(data.bitrate),
    expiresAt: input.expiresAt,
    genre: asString(data.servergenre),
    rawTitle,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "shoutcast-status",
    stationName: asString(data.servertitle),
    streamUrl: input.streamUrl,
  });
}

function getShoutcast7HtmlTitle(text: string): string | null {
  const fields = text.split(",");
  if (fields.length < 2) {
    return asString(text);
  }

  const titleOffset = fields.findIndex((field, index) => {
    if (index > 5) {
      return true;
    }
    return !INTEGER_FIELD_PATTERN.test(field.trim());
  });
  if (titleOffset < 0) {
    return null;
  }
  return asString(fields.slice(titleOffset).join(","));
}

function normalizeShoutcastText(input: {
  text: string;
  streamUrl: string;
  resolvedUrl?: string;
  isSevenHtml?: boolean;
  sampledAt: number;
  expiresAt: number;
}): RadioNowPlaying | null {
  const rawTitle = input.isSevenHtml
    ? getShoutcast7HtmlTitle(input.text)
    : asString(input.text);
  if (!rawTitle || rawTitle === "-" || rawTitle === "- -") {
    return null;
  }
  return buildNowPlaying({
    expiresAt: input.expiresAt,
    rawTitle,
    resolvedUrl: input.resolvedUrl,
    sampledAt: input.sampledAt,
    source: "shoutcast-status",
    streamUrl: input.streamUrl,
  });
}

async function tryShoutcastUrl(
  input: ExternalMetadataProviderInput,
  url: string
): Promise<RadioNowPlaying | null> {
  if (url.includes("json=1") || url.includes("/stats")) {
    const result = await fetchObjectJson(input.fetchImpl, url);
    return result
      ? normalizeShoutcastJson({
          data: result.data,
          expiresAt: input.expiresAt,
          resolvedUrl: result.response.url || url,
          sampledAt: input.sampledAt,
          streamUrl: input.streamUrl,
        })
      : null;
  }

  const result = await fetchText(input.fetchImpl, url);
  return result
    ? normalizeShoutcastText({
        expiresAt: input.expiresAt,
        isSevenHtml: url.includes("/7.html"),
        resolvedUrl: result.response.url || url,
        sampledAt: input.sampledAt,
        streamUrl: input.streamUrl,
        text: result.text,
      })
    : null;
}

export async function tryShoutcastStatus(
  input: ExternalMetadataProviderInput,
  options: { endpoint?: string; sid?: string } = {}
): Promise<RadioNowPlaying | null> {
  const urls = options.endpoint
    ? [options.endpoint]
    : getShoutcastCandidateUrls(input.streamUrl, options.sid);
  return await findSequential([...new Set(urls)], async (url) => {
    try {
      return await tryShoutcastUrl(input, url);
    } catch (error) {
      if (shouldPropagateFetchError(error)) {
        throw error;
      }
      return null;
    }
  });
}

export async function tryAirtimeLiveInfo(
  input: ExternalMetadataProviderInput,
  urls = getAirtimeCandidateUrls(input.streamUrl)
): Promise<RadioNowPlaying | null> {
  return await findSequential([...new Set(urls)], async (url) => {
    let result: Awaited<ReturnType<typeof fetchObjectJson>>;
    try {
      result = await fetchObjectJson(input.fetchImpl, url);
    } catch (error) {
      if (shouldPropagateFetchError(error)) {
        throw error;
      }
      return null;
    }
    return result
      ? normalizeAirtimeLiveInfo({
          data: result.data as AirtimeLiveInfo,
          expiresAt: input.expiresAt,
          resolvedUrl: result.response.url || url,
          sampledAt: input.sampledAt,
          streamUrl: input.streamUrl,
        })
      : null;
  });
}

export async function tryNtsLiveApi(
  input: ExternalMetadataProviderInput,
  requestedChannel?: "1" | "2"
): Promise<RadioNowPlaying | null> {
  let result: Awaited<ReturnType<typeof fetchObjectJson>>;
  try {
    result = await fetchObjectJson(
      input.fetchImpl,
      "https://www.nts.live/api/v2/live"
    );
  } catch (error) {
    if (shouldPropagateFetchError(error)) {
      throw error;
    }
    return null;
  }
  if (!result) {
    return null;
  }
  const channelName =
    requestedChannel ??
    (new URL(input.streamUrl).pathname === "/stream2" ? "2" : "1");
  const { results } = result.data as { results?: unknown };
  const channel = Array.isArray(results)
    ? results.find(
        (item) =>
          (item as { channel_name?: unknown }).channel_name === channelName
      )
    : null;
  const now = (
    channel as {
      now?: {
        broadcast_title?: unknown;
        links?: Link[];
        embeds?: {
          details?: {
            name?: unknown;
            description?: unknown;
            genres?: { value?: unknown }[];
            media?: { picture_medium?: unknown };
            links?: Link[];
          };
        };
      };
    } | null
  )?.now;
  const title =
    asString(now?.broadcast_title) ?? asString(now?.embeds?.details?.name);
  if (!title) {
    return null;
  }

  const apiItemUrl =
    now?.links?.find((link) => asString(link.rel) === "details")?.href ??
    now?.embeds?.details?.links?.find((link) => asString(link.rel) === "self")
      ?.href;
  const itemUrl = asPublicUrl(apiItemUrl)?.replace(
    "https://www.nts.live/api/v2/shows/",
    "https://www.nts.live/shows/"
  );

  return buildNowPlaying({
    artworkUrl: asString(now?.embeds?.details?.media?.picture_medium),
    expiresAt: input.expiresAt,
    genre: asString(now?.embeds?.details?.genres?.[0]?.value),
    itemUrl,
    rawTitle: title,
    resolvedUrl: result.response.url || "https://www.nts.live/api/v2/live",
    sampledAt: input.sampledAt,
    source: "nts-live-api",
    stationDescription: asString(now?.embeds?.details?.description),
    streamUrl: input.streamUrl,
  });
}

export async function tryRadioBlackoutApi(
  input: ExternalMetadataProviderInput,
  endpoint = "https://radioblackout.org/api/listening"
): Promise<RadioNowPlaying | null> {
  let result: Awaited<ReturnType<typeof fetchObjectJson>>;
  try {
    result = await fetchObjectJson(input.fetchImpl, endpoint);
  } catch (error) {
    if (shouldPropagateFetchError(error)) {
      throw error;
    }
    return null;
  }
  if (!result) {
    return null;
  }
  const data = result.data as BlackoutListening;
  const title = asString(data.title);
  if (!title) {
    return null;
  }
  return buildNowPlaying({
    artworkUrl: asString(data.featured_media),
    expiresAt: input.expiresAt,
    itemUrl: asPublicUrl(data.link),
    rawTitle: title,
    resolvedUrl: result.response.url || endpoint,
    sampledAt: input.sampledAt,
    source: "radio-blackout-api",
    stationDescription: asString(data.excerpt),
    streamUrl: input.streamUrl,
  });
}
