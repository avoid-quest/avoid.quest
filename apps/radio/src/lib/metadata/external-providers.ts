import { parseRadioTitle } from "./title-parser";
import type { RadioMetadataSource, RadioNowPlaying } from "./types";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type AirtimeTrack = {
  name?: unknown;
  metadata?: {
    artist_name?: unknown;
    track_title?: unknown;
    album_title?: unknown;
    genre?: unknown;
    artwork_url?: unknown;
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
};

type BlackoutListening = {
  title?: unknown;
  excerpt?: unknown;
  featured_media?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function first<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function buildNowPlaying(input: {
  streamUrl: string;
  resolvedUrl?: string;
  source: RadioMetadataSource;
  rawTitle: string;
  artworkUrl?: string | null;
  stationDescription?: string | null;
  genre?: string | null;
  sampledAt: number;
  expiresAt: number;
}): RadioNowPlaying | null {
  const parsed = parseRadioTitle(input.rawTitle);
  if (!(parsed.title || parsed.artist)) {
    return null;
  }

  return {
    streamUrl: input.streamUrl,
    resolvedUrl: input.resolvedUrl,
    source: input.source,
    title: parsed.title,
    artist: parsed.artist,
    rawTitle: parsed.rawTitle,
    artworkUrl: input.artworkUrl ?? null,
    stationName: null,
    stationDescription: input.stationDescription ?? null,
    genre: input.genre ?? null,
    bitrate: null,
    sampledAt: input.sampledAt,
    expiresAt: input.expiresAt,
  };
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
    streamUrl: input.streamUrl,
    resolvedUrl: input.resolvedUrl,
    source: "airtime-live-info",
    rawTitle,
    artworkUrl: asString(metadata?.artwork_url) ?? asString(show?.image_path),
    stationDescription: asString(show?.description),
    genre: asString(metadata?.genre),
    sampledAt: input.sampledAt,
    expiresAt: input.expiresAt,
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
    urls.unshift("https://cashmereradio.airtime.pro/api/live-info-v2");
    urls.unshift("https://cashmereradio.airtime.pro/api/live-info");
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

export async function tryAirtimeLiveInfo(input: {
  fetchImpl: FetchLike;
  streamUrl: string;
  sampledAt: number;
  expiresAt: number;
}): Promise<RadioNowPlaying | null> {
  for (const url of getAirtimeCandidateUrls(input.streamUrl)) {
    const result = await fetchObjectJson(input.fetchImpl, url);
    if (!result) {
      continue;
    }
    const normalized = normalizeAirtimeLiveInfo({
      data: result.data as AirtimeLiveInfo,
      streamUrl: input.streamUrl,
      resolvedUrl: result.response.url || url,
      sampledAt: input.sampledAt,
      expiresAt: input.expiresAt,
    });
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export async function tryNtsLiveApi(input: {
  fetchImpl: FetchLike;
  streamUrl: string;
  sampledAt: number;
  expiresAt: number;
}): Promise<RadioNowPlaying | null> {
  const url = new URL(input.streamUrl);
  if (url.hostname !== "stream-relay-geo.ntslive.net") {
    return null;
  }

  const result = await fetchObjectJson(
    input.fetchImpl,
    "https://www.nts.live/api/v2/live"
  );
  if (!result) {
    return null;
  }
  const channelName = url.pathname === "/stream2" ? "2" : "1";
  const results = (result.data as { results?: unknown }).results;
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
        embeds?: {
          details?: {
            name?: unknown;
            description?: unknown;
            media?: { picture_medium?: unknown };
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

  return buildNowPlaying({
    streamUrl: input.streamUrl,
    resolvedUrl: result.response.url || "https://www.nts.live/api/v2/live",
    source: "nts-live-api",
    rawTitle: title,
    artworkUrl: asString(now?.embeds?.details?.media?.picture_medium),
    stationDescription: asString(now?.embeds?.details?.description),
    sampledAt: input.sampledAt,
    expiresAt: input.expiresAt,
  });
}

export async function tryRadioBlackoutApi(input: {
  fetchImpl: FetchLike;
  streamUrl: string;
  sampledAt: number;
  expiresAt: number;
}): Promise<RadioNowPlaying | null> {
  const url = new URL(input.streamUrl);
  if (
    !(
      url.hostname === "zeppelin.streampunk.cc" &&
      url.pathname.includes("blackout")
    )
  ) {
    return null;
  }
  const endpoint = "https://radioblackout.org/api/listening";
  const result = await fetchObjectJson(input.fetchImpl, endpoint);
  if (!result) {
    return null;
  }
  const data = result.data as BlackoutListening;
  const title = asString(data.title);
  if (!title) {
    return null;
  }
  return buildNowPlaying({
    streamUrl: input.streamUrl,
    resolvedUrl: result.response.url || endpoint,
    source: "radio-blackout-api",
    rawTitle: title,
    artworkUrl: asString(data.featured_media),
    stationDescription: asString(data.excerpt),
    sampledAt: input.sampledAt,
    expiresAt: input.expiresAt,
  });
}
