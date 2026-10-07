import type {
  BandcampItemError,
  BandcampItemResponse,
  BandcampItemResult,
  BandcampTrackInfo,
} from "./types.js";

export type {
  BandcampItemError,
  BandcampItemResponse,
  BandcampItemResult,
  BandcampItemType,
  BandcampMetadata,
  BandcampTrackInfo,
} from "./types.js";

import { load } from "cheerio";
import { decode } from "html-entities";
import { BROWSER_USER_AGENT } from "../browser-user-agent.js";
import type { FetchLike } from "../redirects/validated-redirects.js";
import {
  fetchWithValidatedRedirects,
  ValidatedRedirectError,
} from "../redirects/validated-redirects.js";
import { normalizePlatformHostname } from "../url-policy/hostname.js";
import { detectBandcampItemType } from "./detect.js";
import { isBandcampHostname, validateBandcampCdnUrl } from "./url-policy.js";

export {
  BANDCAMP_HTML_MARKERS,
  detectBandcampFromHtml,
  detectBandcampItemType,
  isBandcampUrl,
  normalizeBandcampUrl,
} from "./detect.js";
export type { BandcampSearchFilter, BandcampSearchResult } from "./search.js";
export { searchBandcamp } from "./search.js";
export type {
  BandcampCdnRedirectUrlValidationFailure,
  BandcampCdnRedirectUrlValidationResult,
  BandcampCdnUrlValidationFailure,
  BandcampCdnUrlValidationResult,
} from "./url-policy.js";
export {
  isBandcampCdnHostname,
  isBandcampHostname,
  validateBandcampCdnRedirectUrl,
  validateBandcampCdnUrl,
} from "./url-policy.js";

// Top-level regex patterns for performance
const TRAILING_SLASH_RE = /\/?$/;
const FAN_ID_RE = /fan_id["\s:]+(\d+)/;
const USERNAME_RE = /bandcamp\.com\/([^/]+)/;
const LEADING_DASH_RE = /^\s*-\s*/;
const CHALLENGE_RE = /captcha|challenge/i;

type BandcampBasicData = {
  name: string;
  byArtist: { name: string };
  image: string;
  inAlbum?: { name: string };
  album?: { image: string };
};

type RawBandcampTrack = {
  title: string;
  file?: { "mp3-128": string };
  duration?: number;
  track_num?: number;
};

type BandcampExtraData = {
  trackinfo?: RawBandcampTrack[];
  url?: string;
};

export type BandcampItemOptions = {
  fetchImpl?: FetchLike;
  relayBaseUrls?: readonly string[];
  signal?: AbortSignal;
};

type BandcampLoadOptions = BandcampItemOptions & {
  // Shared with child pages so one item load emits at most one diagnostic.
  directFallback: { logged: boolean };
  signal: AbortSignal;
};

const REQUEST_TIMEOUT_MS = 10_000;
// Four page loads keep shared Worker egress from bursting at public relays.
const PAGE_CONCURRENCY = 4;
const MAX_ARTIST_ALBUMS = 10;
// Fetch more collection items since many won't have free streaming
const MAX_COLLECTION_ITEMS = 50;

function bandcampStreamFormat(
  format?: BandcampTrackInfo["format"]
): "hls" | "progressive" {
  return format === "hls" ? "hls" : "progressive";
}

function createErrorResponse(message: string): BandcampItemError {
  return {
    error: message,
    success: false,
  };
}

export async function getBandcampItem(
  url: string,
  options: BandcampItemOptions = {}
): Promise<BandcampItemResponse> {
  return await loadBandcampItem(url, {
    ...options,
    directFallback: { logged: false },
    signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function loadBandcampItem(
  url: string,
  options: BandcampLoadOptions
): Promise<BandcampItemResponse> {
  try {
    options.signal.throwIfAborted();
    const pageUrl = bandcampPageUrl(url);
    const parsed = new URL(pageUrl);
    const itemType = detectBandcampItemType(
      `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`
    );

    if (itemType === "album") {
      return await getBandcampAlbum(pageUrl, options);
    }
    if (itemType === "track") {
      return await getBandcampTrack(pageUrl, options);
    }
    if (itemType === "artist") {
      return await getBandcampArtist(pageUrl, options);
    }
    if (itemType === "collection") {
      return await getBandcampCollection(pageUrl, options);
    }

    return createErrorResponse(`${itemType} pages are not yet supported`);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return createErrorResponse(`Failed to get Bandcamp item: ${errorMessage}`);
  }
}

function bandcampPageUrl(url: string): string {
  const parsed = URL.canParse(url) ? new URL(url) : null;
  if (
    !parsed ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !isBandcampHostname(parsed.hostname) ||
    parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    throw new ValidatedRedirectError("unsafe-bandcamp-url", url);
  }
  parsed.protocol = "https:";
  parsed.hostname = normalizePlatformHostname(parsed.hostname);
  return parsed.origin + parsed.pathname + parsed.search;
}

function bandcampReleaseUrl(
  href: string | undefined,
  base: string
): string | null {
  try {
    if (!href) {
      return null;
    }
    const parsed = new URL(bandcampPageUrl(new URL(href, base).href));
    return parsed.pathname.startsWith("/album/") ||
      parsed.pathname.startsWith("/track/")
      ? parsed.origin + parsed.pathname
      : null;
  } catch {
    return null;
  }
}

function bandcampArtworkUrl(url: string | undefined): string | undefined {
  const validated = validateBandcampCdnUrl(url ?? null);
  return validated.ok ? validated.url : undefined;
}

function warnBandcampDirectFallback(
  url: string,
  response: Response | undefined,
  html: string,
  options: BandcampLoadOptions
) {
  if (!options.relayBaseUrls?.length || options.directFallback.logged) {
    return;
  }
  const $ = load(html);
  const jsonLd = $('script[type="application/ld+json"]');
  options.directFallback.logged = true;
  console.warn({
    bodyLength: html.length,
    hasChallenge: CHALLENGE_RE.test(html),
    hasJsonLd: jsonLd.length > 0,
    hasTralbum: html.includes("data-tralbum"),
    headers: Object.fromEntries(
      [...(response?.headers ?? [])].flatMap(([name, value]) =>
        ["server", "content-type", "cf-mitigated", "content-length"].includes(
          name
        )
          ? [[name, value.slice(0, 80)]]
          : []
      )
    ),
    hostname: new URL(url).hostname,
    stage: "bandcamp-direct",
    status: response?.status ?? null,
    title: $("title").text().trim().slice(0, 80),
  });
}

async function readBandcampPageBody(
  response: Response,
  relay: string,
  options: BandcampLoadOptions
): Promise<string> {
  if (response.ok) {
    return response.text();
  }
  if (
    relay ||
    !options.relayBaseUrls?.length ||
    options.directFallback.logged
  ) {
    return "";
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }
  const bytes = new Uint8Array(8192);
  let length = 0;
  try {
    while (length < bytes.length) {
      // biome-ignore lint/performance/noAwaitInLoops: read only a bounded prefix for diagnostics
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = value.subarray(0, bytes.length - length);
      bytes.set(chunk, length);
      length += chunk.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(bytes.subarray(0, length));
}

async function fetchBandcampPage<T>(
  url: string,
  options: BandcampLoadOptions,
  parse: (html: string, url: string) => T
): Promise<T> {
  const rebuilt = bandcampPageUrl(url);
  let lastError: unknown;
  for (const relay of ["", ...(options.relayBaseUrls ?? [])]) {
    let response: Response | undefined;
    let html = "";
    try {
      options.signal.throwIfAborted();
      // Encode once so a relay's single decode preserves the validated URL.
      const target = relay ? relay + encodeURIComponent(rebuilt) : rebuilt;
      // biome-ignore lint/performance/noAwaitInLoops: direct first, then relays in priority order
      const fetched = await fetchWithValidatedRedirects({
        fetchImpl: options.fetchImpl ?? fetch,
        init: {
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": BROWSER_USER_AGENT,
          },
          signal: options.signal,
        },
        invalidUrlReason: "unsafe-bandcamp-url",
        maxRedirects: relay ? 0 : undefined,
        url: target,
        validateUrl: (nextUrl) => {
          try {
            return {
              ok: true,
              url: relay ? nextUrl : bandcampPageUrl(nextUrl),
            };
          } catch {
            return { ok: false, reason: "unsafe-bandcamp-url" };
          }
        },
      });
      ({ response } = fetched);
      html = await readBandcampPageBody(response, relay, options);
      if (!response.ok) {
        throw new Error(`Failed to fetch Bandcamp page: ${response.status}`);
      }
      return parse(html, relay ? rebuilt : fetched.resolvedUrl);
    } catch (error) {
      options.signal.throwIfAborted();
      if (error instanceof ValidatedRedirectError) {
        throw error;
      }
      warnBandcampDirectFallback(rebuilt, response, html, options);
      lastError = error;
    } finally {
      if (!response?.bodyUsed) {
        await response?.body?.cancel().catch(() => undefined);
      }
    }
  }
  throw lastError;
}

async function loadBandcampItems(urls: string[], options: BandcampLoadOptions) {
  const results: BandcampItemResponse[] = [];
  const pending = urls.entries();
  await Promise.all(
    Array.from(
      { length: Math.min(PAGE_CONCURRENCY, urls.length) },
      async () => {
        for (const [index, url] of pending) {
          // biome-ignore lint/performance/noAwaitInLoops: each worker owns one page load at a time
          results[index] = await loadBandcampItem(url, options);
        }
      }
    )
  );
  return results;
}

function parseBandcampData(html: string, url: string) {
  const $ = load(html);
  const rawBasic = $('script[type="application/ld+json"]').html();
  const rawExtra = $("script[data-tralbum]").attr("data-tralbum");

  if (!(rawBasic && rawExtra)) {
    throw new Error(
      "Failed to parse Bandcamp data: missing JSON-LD or tralbum data"
    );
  }

  let basic: BandcampBasicData;
  try {
    basic = JSON.parse(rawBasic) as BandcampBasicData;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse "basic" JSON-LD data: ${message}. Raw payload: ${rawBasic}`,
      { cause: error }
    );
  }

  let extra: BandcampExtraData;
  try {
    const decodedExtra = decode(rawExtra);
    extra = JSON.parse(decodedExtra) as BandcampExtraData;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse "extra" tralbum data: ${message}. Raw payload: ${rawExtra}`,
      { cause: error }
    );
  }

  let identityUrl: string;
  try {
    identityUrl = bandcampPageUrl(
      $("meta[property='og:url']").attr("content") ?? extra.url ?? ""
    );
  } catch (error) {
    throw new Error(
      "Failed to parse Bandcamp data: missing or unsafe page URL",
      { cause: error }
    );
  }
  if (new URL(identityUrl).hostname !== new URL(url).hostname) {
    throw new Error(
      "Failed to parse Bandcamp data: page hostname does not match request"
    );
  }

  return { basic, extra };
}

async function getBandcampAlbum(
  url: string,
  options: BandcampLoadOptions
): Promise<BandcampItemResult | BandcampItemError> {
  const { basic, extra } = await fetchBandcampPage(
    url,
    options,
    parseBandcampData
  );

  if (!extra.trackinfo || extra.trackinfo.length === 0) {
    return createErrorResponse("No tracks found in album");
  }

  const mappedTracks = extra.trackinfo.flatMap((track, index) => {
    const stream = validateBandcampCdnUrl(
      track.file?.["mp3-128"]?.trim() ?? null
    );
    return stream.ok
      ? [
          {
            duration: track.duration,
            format: "progressive" as const,
            name: track.title,
            streamUrl: stream.url,
            trackNumber: track.track_num || index + 1,
          },
        ]
      : [];
  });

  if (mappedTracks.length === 0) {
    return createErrorResponse("No playable tracks found in album");
  }

  const totalDuration = mappedTracks.reduce(
    (sum, track) => sum + (track.duration || 0),
    0
  );

  return {
    format: "progressive",
    metadata: {
      albumName: basic.name,
      artist: basic.byArtist.name,
      artwork: bandcampArtworkUrl(basic.image),
      duration: totalDuration > 0 ? totalDuration : undefined,
      itemType: "album",
      name: basic.name,
      platform: "bandcamp",
      streamUrl: mappedTracks[0]?.streamUrl,
      trackCount: mappedTracks.length,
      tracks: mappedTracks,
      url,
    },
    streamUrl: mappedTracks[0]?.streamUrl || "",
    success: true,
  };
}

async function getBandcampTrack(
  url: string,
  options: BandcampLoadOptions
): Promise<BandcampItemResult | BandcampItemError> {
  const { basic, extra } = await fetchBandcampPage(
    url,
    options,
    parseBandcampData
  );

  const trackInfo = extra.trackinfo?.[0];

  const stream = validateBandcampCdnUrl(
    trackInfo?.file?.["mp3-128"]?.trim() ?? null
  );
  if (!(trackInfo && stream.ok)) {
    return createErrorResponse("No playable tracks found for track");
  }

  return {
    format: "progressive",
    metadata: {
      albumName: basic.inAlbum?.name,
      artist: basic.byArtist.name,
      artwork: bandcampArtworkUrl(basic.image || basic.album?.image),
      duration: trackInfo.duration,
      itemType: "track",
      name: basic.name,
      platform: "bandcamp",
      streamUrl: stream.url,
      url,
    },
    streamUrl: stream.url,
    success: true,
  };
}

// ============================================
// Artist Page Support
// ============================================

type DiscographyInfo = {
  albumUrls: string[];
  artistName: string;
  artwork?: string;
};

function parseArtistDiscography(
  html: string,
  baseUrl: string
): DiscographyInfo {
  const $ = load(html);

  const artistName =
    $("meta[property='og:site_name']").attr("content") ||
    $("p#band-name-location .title").text().trim() ||
    $("span[itemprop='name']").first().text().trim() ||
    "Unknown Artist";

  const artwork =
    $("meta[property='og:image']").attr("content") ||
    $("img.band-photo").attr("src") ||
    $("a.popupImage img").attr("src");

  const albumUrls: string[] = [];
  const seen = new Set<string>();

  $("a[href*='/album/'], a[href*='/track/']").each((_, el) => {
    const fullUrl = bandcampReleaseUrl($(el).attr("href"), baseUrl);
    if (fullUrl && !seen.has(fullUrl)) {
      seen.add(fullUrl);
      albumUrls.push(fullUrl);
    }
  });

  return { albumUrls, artistName, artwork: bandcampArtworkUrl(artwork) };
}

/**
 * Extract tracks from successful fetch results
 */
function aggregateTracksFromResults(
  results: BandcampItemResponse[],
  initialArtwork?: string
): { tracks: BandcampTrackInfo[]; artwork?: string } {
  const allTracks: BandcampTrackInfo[] = [];
  let firstArtwork = initialArtwork;

  for (const result of results) {
    if (!result.success) {
      continue;
    }

    const meta = result.metadata;
    if (!firstArtwork && meta.artwork) {
      firstArtwork = meta.artwork;
    }

    if (meta.tracks && meta.tracks.length > 0) {
      for (const track of meta.tracks) {
        if (track.streamUrl) {
          allTracks.push({
            duration: track.duration,
            format: bandcampStreamFormat(track.format),
            name: `${meta.name} - ${track.name}`,
            streamUrl: track.streamUrl,
            trackNumber: allTracks.length + 1,
          });
        }
      }
    } else if (meta.streamUrl) {
      allTracks.push({
        duration: meta.duration,
        format: bandcampStreamFormat(result.format),
        name: meta.name || "Unknown Track",
        streamUrl: meta.streamUrl,
        trackNumber: allTracks.length + 1,
      });
    }
  }

  return { artwork: firstArtwork, tracks: allTracks };
}

async function getBandcampArtist(
  url: string,
  options: BandcampLoadOptions
): Promise<BandcampItemResult | BandcampItemError> {
  let musicUrl = url;
  const hasPath =
    url.includes("/music") ||
    url.includes("/album/") ||
    url.includes("/track/");
  if (!hasPath) {
    musicUrl = url.replace(TRAILING_SLASH_RE, "/music");
  }

  const { albumUrls, artistName, artwork } = await fetchBandcampPage(
    musicUrl,
    options,
    (html) => {
      const discography = parseArtistDiscography(html, url);
      if (discography.albumUrls.length === 0) {
        throw new Error("No albums or tracks found on artist page");
      }
      return discography;
    }
  );

  const urlsToFetch = albumUrls.slice(0, MAX_ARTIST_ALBUMS);
  const results = await loadBandcampItems(urlsToFetch, options);

  const { tracks: allTracks, artwork: finalArtwork } =
    aggregateTracksFromResults(results, artwork);

  if (allTracks.length === 0) {
    return createErrorResponse("No playable tracks found on artist page");
  }

  const totalDuration = allTracks.reduce(
    (sum, track) => sum + (track.duration || 0),
    0
  );

  return {
    format: allTracks[0]?.format ?? "progressive",
    metadata: {
      artist: artistName,
      artwork: finalArtwork,
      duration: totalDuration > 0 ? totalDuration : undefined,
      itemType: "artist",
      name: artistName,
      platform: "bandcamp",
      streamUrl: allTracks[0]?.streamUrl,
      trackCount: allTracks.length,
      tracks: allTracks,
      url,
    },
    streamUrl: allTracks[0]?.streamUrl || "",
    success: true,
  };
}

// ============================================
// Collection Page Support
// ============================================

function extractFanId(html: string): string | null {
  const $ = load(html);

  const pageDataBlob = $("#pagedata").attr("data-blob");
  if (pageDataBlob) {
    try {
      const data = JSON.parse(pageDataBlob) as { fan_id?: number };
      if (data.fan_id) {
        return String(data.fan_id);
      }
    } catch {
      // Continue
    }
  }

  const scriptMatch = html.match(FAN_ID_RE);
  if (scriptMatch?.[1]) {
    return scriptMatch[1];
  }

  const fanIdAttr = $("[data-fan-id]").attr("data-fan-id");
  if (fanIdAttr) {
    return fanIdAttr;
  }

  return null;
}

function parseVisibleCollectionItems(html: string, base: string): string[] {
  const $ = load(html);
  const items: string[] = [];
  const seen = new Set<string>();

  $("a[href*='.bandcamp.com/album/'], a[href*='.bandcamp.com/track/']").each(
    (_, el) => {
      const url = bandcampReleaseUrl($(el).attr("href"), base);
      if (!url || seen.has(url)) {
        return;
      }
      seen.add(url);

      items.push(url);
    }
  );

  return items;
}

type CollectionApiResponse = {
  items?: Array<{
    item_url?: string;
  }>;
};

async function fetchCollectionFromApi(
  fanId: string,
  options: BandcampLoadOptions
): Promise<string[]> {
  const apiUrl = "https://bandcamp.com/api/fancollection/1/collection_items";
  const response = await (options.fetchImpl ?? fetch)(apiUrl, {
    body: JSON.stringify({
      count: MAX_COLLECTION_ITEMS,
      fan_id: Number(fanId),
      older_than_token: null,
    }),
    headers: {
      "Content-Type": "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
    method: "POST",
    redirect: "manual",
    signal: options.signal,
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    console.warn(`[Bandcamp] fetchCollectionFromApi HTTP ${response.status}`);
    return [];
  }

  const data = (await response.json()) as CollectionApiResponse;
  if (!data.items || data.items.length === 0) {
    return [];
  }

  return data.items.flatMap((item) => {
    const url = bandcampReleaseUrl(item.item_url, apiUrl);
    return url ? [url] : [];
  });
}

/**
 * Format track name with artist prefix for collection
 */
function formatCollectionTrackName(artist: string, name: string): string {
  const prefix = artist || "";
  const fullName = `${prefix} - ${name}`;
  return fullName.replace(LEADING_DASH_RE, "");
}

/**
 * Aggregate tracks from collection results (with artist prefix)
 */
function aggregateCollectionTracks(results: BandcampItemResponse[]): {
  tracks: BandcampTrackInfo[];
  artwork?: string;
} {
  const allTracks: BandcampTrackInfo[] = [];
  let firstArtwork: string | undefined;

  for (const result of results) {
    if (!result.success) {
      continue;
    }

    const meta = result.metadata;
    firstArtwork ??= meta.artwork;

    if (meta.tracks && meta.tracks.length > 0) {
      for (const track of meta.tracks) {
        if (!track.streamUrl) {
          continue;
        }
        allTracks.push({
          duration: track.duration,
          format: bandcampStreamFormat(track.format),
          name: formatCollectionTrackName(
            meta.artist || meta.name || "",
            track.name
          ),
          streamUrl: track.streamUrl,
          trackNumber: allTracks.length + 1,
        });
      }
    } else if (meta.streamUrl) {
      allTracks.push({
        duration: meta.duration,
        format: bandcampStreamFormat(result.format),
        name: formatCollectionTrackName(meta.artist || "", meta.name || ""),
        streamUrl: meta.streamUrl,
        trackNumber: allTracks.length + 1,
      });
    }
  }

  return { artwork: firstArtwork, tracks: allTracks };
}

async function getBandcampCollection(
  url: string,
  options: BandcampLoadOptions
): Promise<BandcampItemResult | BandcampItemError> {
  const collectionData = await fetchBandcampPage(url, options, (html) => {
    const fanId = extractFanId(html);
    const visibleItems = parseVisibleCollectionItems(html, url);
    if (!fanId && visibleItems.length === 0) {
      throw new Error("No collection data found on Bandcamp page");
    }
    return { fanId, visibleItems };
  });

  const usernameMatch = url.match(USERNAME_RE);
  const username = usernameMatch?.[1] || "Unknown User";

  let collectionItems: string[] = [];

  if (collectionData.fanId) {
    try {
      collectionItems = await fetchCollectionFromApi(
        collectionData.fanId,
        options
      );
    } catch (error) {
      options.signal?.throwIfAborted();
      console.warn(
        "[Bandcamp] Collection API failed, falling back to HTML parsing:",
        error
      );
    }
  }

  if (collectionItems.length === 0) {
    collectionItems = collectionData.visibleItems;
  }

  if (collectionItems.length === 0) {
    return createErrorResponse(
      "No collection items found. The collection may be private or empty."
    );
  }

  const urlsToFetch = collectionItems.slice(0, MAX_COLLECTION_ITEMS);
  const results = await loadBandcampItems(urlsToFetch, options);

  const { tracks: allTracks, artwork } = aggregateCollectionTracks(results);

  if (allTracks.length === 0) {
    return createErrorResponse(
      `Found ${collectionItems.length} items but none have free streaming. ` +
        "Only 'name your price' or free albums can be played without purchase."
    );
  }

  const totalDuration = allTracks.reduce(
    (sum, track) => sum + (track.duration || 0),
    0
  );

  return {
    format: allTracks[0]?.format ?? "progressive",
    metadata: {
      artist: username,
      artwork,
      duration: totalDuration > 0 ? totalDuration : undefined,
      itemType: "collection",
      name: `${username}'s Collection`,
      platform: "bandcamp",
      streamUrl: allTracks[0]?.streamUrl,
      trackCount: allTracks.length,
      tracks: allTracks,
      url,
    },
    streamUrl: allTracks[0]?.streamUrl || "",
    success: true,
  };
}
