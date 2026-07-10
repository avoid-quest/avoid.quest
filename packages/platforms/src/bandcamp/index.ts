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

import { detectBandcampItemType } from "./detect.js";
import { validateBandcampCdnUrl } from "./url-policy.js";

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
};

/** Proxies bcbits.com URLs through the API to avoid CORS issues. */
export function getProxiedBandcampUrl(url: string): string {
  if (validateBandcampCdnUrl(url).ok) {
    return `/api/bandcamp-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

const REQUEST_TIMEOUT_MS = 10_000;
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
    success: false,
    error: message,
  };
}

export async function getBandcampItem(
  url: string
): Promise<BandcampItemResponse> {
  try {
    const itemType = detectBandcampItemType(url);

    if (itemType === "album") {
      return await getBandcampAlbum(url);
    }
    if (itemType === "track") {
      return await getBandcampTrack(url);
    }
    if (itemType === "artist") {
      return await getBandcampArtist(url);
    }
    if (itemType === "collection") {
      return await getBandcampCollection(url);
    }

    return createErrorResponse(`${itemType} pages are not yet supported`);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return createErrorResponse(`Failed to get Bandcamp item: ${errorMessage}`);
  }
}

async function fetchBandcampPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Bandcamp page: ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after 10 seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseBandcampData(html: string) {
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
      { cause: error instanceof Error ? error : undefined }
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
      { cause: error instanceof Error ? error : undefined }
    );
  }

  return { basic, extra };
}

async function getBandcampAlbum(
  url: string
): Promise<BandcampItemResult | BandcampItemError> {
  const html = await fetchBandcampPage(url);
  const { basic, extra } = parseBandcampData(html);

  if (!extra.trackinfo || extra.trackinfo.length === 0) {
    return createErrorResponse("No tracks found in album");
  }

  const mappedTracks = extra.trackinfo.flatMap((track, index) => {
    const streamUrl = track.file?.["mp3-128"]?.trim();
    return streamUrl
      ? [
          {
            format: "progressive" as const,
            name: track.title,
            streamUrl,
            duration: track.duration,
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
    success: true,
    format: "progressive",
    metadata: {
      platform: "bandcamp",
      itemType: "album",
      url,
      name: basic.name,
      artist: basic.byArtist.name,
      artwork: basic.image,
      albumName: basic.name,
      trackCount: mappedTracks.length,
      duration: totalDuration > 0 ? totalDuration : undefined,
      tracks: mappedTracks,
      streamUrl: mappedTracks[0]?.streamUrl,
    },
    streamUrl: mappedTracks[0]?.streamUrl || "",
  };
}

async function getBandcampTrack(
  url: string
): Promise<BandcampItemResult | BandcampItemError> {
  const html = await fetchBandcampPage(url);
  const { basic, extra } = parseBandcampData(html);

  const trackInfo = extra.trackinfo?.[0];

  if (!trackInfo?.file?.["mp3-128"]) {
    return createErrorResponse("No stream URL found for track");
  }

  return {
    success: true,
    format: "progressive",
    metadata: {
      platform: "bandcamp",
      itemType: "track",
      url,
      name: basic.name,
      artist: basic.byArtist.name,
      artwork: basic.image || basic.album?.image,
      albumName: basic.inAlbum?.name,
      duration: trackInfo.duration,
      streamUrl: trackInfo.file["mp3-128"],
    },
    streamUrl: trackInfo.file["mp3-128"],
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
    const href = $(el).attr("href");
    if (!href) {
      return;
    }

    let fullUrl: string | null = null;
    if (href.startsWith("http")) {
      fullUrl = href;
    } else if (href.startsWith("/")) {
      try {
        const base = new URL(baseUrl);
        fullUrl = `${base.origin}${href}`;
      } catch {
        return;
      }
    }

    if (fullUrl && !seen.has(fullUrl)) {
      seen.add(fullUrl);
      albumUrls.push(fullUrl);
    }
  });

  return { albumUrls, artistName, artwork };
}

/**
 * Extract tracks from successful fetch results
 */
function aggregateTracksFromResults(
  results: PromiseSettledResult<BandcampItemResponse>[],
  initialArtwork?: string
): { tracks: BandcampTrackInfo[]; artwork?: string } {
  const allTracks: BandcampTrackInfo[] = [];
  let firstArtwork = initialArtwork;

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.success) {
      continue;
    }

    const meta = result.value.metadata;
    if (!firstArtwork && meta.artwork) {
      firstArtwork = meta.artwork;
    }

    if (meta.tracks && meta.tracks.length > 0) {
      for (const track of meta.tracks) {
        if (track.streamUrl) {
          allTracks.push({
            format: bandcampStreamFormat(track.format),
            name: `${meta.name} - ${track.name}`,
            streamUrl: track.streamUrl,
            duration: track.duration,
            trackNumber: allTracks.length + 1,
          });
        }
      }
    } else if (meta.streamUrl) {
      allTracks.push({
        format: bandcampStreamFormat(result.value.format),
        name: meta.name || "Unknown Track",
        streamUrl: meta.streamUrl,
        duration: meta.duration,
        trackNumber: allTracks.length + 1,
      });
    }
  }

  return { tracks: allTracks, artwork: firstArtwork };
}

async function getBandcampArtist(
  url: string
): Promise<BandcampItemResult | BandcampItemError> {
  let musicUrl = url;
  const hasPath =
    url.includes("/music") ||
    url.includes("/album/") ||
    url.includes("/track/");
  if (!hasPath) {
    musicUrl = url.replace(TRAILING_SLASH_RE, "/music");
  }

  const html = await fetchBandcampPage(musicUrl);
  const { albumUrls, artistName, artwork } = parseArtistDiscography(html, url);

  if (albumUrls.length === 0) {
    return createErrorResponse("No albums or tracks found on artist page");
  }

  const urlsToFetch = albumUrls.slice(0, MAX_ARTIST_ALBUMS);
  const results = await Promise.allSettled(
    urlsToFetch.map((albumUrl) => getBandcampItem(albumUrl))
  );

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
    success: true,
    format: allTracks[0]?.format ?? "progressive",
    metadata: {
      platform: "bandcamp",
      itemType: "artist",
      url,
      name: artistName,
      artist: artistName,
      artwork: finalArtwork,
      trackCount: allTracks.length,
      duration: totalDuration > 0 ? totalDuration : undefined,
      tracks: allTracks,
      streamUrl: allTracks[0]?.streamUrl,
    },
    streamUrl: allTracks[0]?.streamUrl || "",
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

type CollectionItem = { url: string; name: string; artist: string };

/**
 * Strip query parameters from URL to get canonical form for deduplication
 */
function getCanonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // If URL parsing fails, strip everything after ?
    const queryIndex = url.indexOf("?");
    return queryIndex === -1 ? url : url.slice(0, queryIndex);
  }
}

function parseVisibleCollectionItems(html: string): CollectionItem[] {
  const $ = load(html);
  const items: CollectionItem[] = [];
  const seen = new Set<string>();

  $("a[href*='.bandcamp.com/album/'], a[href*='.bandcamp.com/track/']").each(
    (_, el) => {
      const href = $(el).attr("href");
      if (!href) {
        return;
      }
      // Normalize URL to avoid duplicates like track/foo and track/foo?action=buy
      const canonical = getCanonicalUrl(href);
      if (seen.has(canonical)) {
        return;
      }
      seen.add(canonical);

      const parent = $(el).closest(
        ".collection-item-container, .item-link-container, li"
      );
      const name =
        parent.find(".collection-item-title, .item-title").text().trim() ||
        $(el).text().trim() ||
        "Unknown";
      const artist =
        parent.find(".collection-item-artist, .item-artist").text().trim() ||
        "";

      items.push({ url: href, name, artist });
    }
  );

  return items;
}

type CollectionApiResponse = {
  items?: Array<{
    item_url?: string;
    item_title?: string;
    band_name?: string;
  }>;
};

async function fetchCollectionFromApi(
  fanId: string
): Promise<CollectionItem[]> {
  const apiUrl = "https://bandcamp.com/api/fancollection/1/collection_items";
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    body: JSON.stringify({
      fan_id: Number(fanId),
      count: MAX_COLLECTION_ITEMS,
      older_than_token: null,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    console.warn(`[Bandcamp] fetchCollectionFromApi HTTP ${response.status}`);
    return [];
  }

  const data = (await response.json()) as CollectionApiResponse;
  if (!data.items || data.items.length === 0) {
    return [];
  }

  return data.items
    .filter((item) => item.item_url)
    .map((item) => ({
      url: item.item_url || "",
      name: item.item_title || "Unknown",
      artist: item.band_name || "",
    }));
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
function aggregateCollectionTracks(
  results: PromiseSettledResult<BandcampItemResponse>[]
): { tracks: BandcampTrackInfo[]; artwork?: string } {
  const allTracks: BandcampTrackInfo[] = [];
  let firstArtwork: string | undefined;

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.success) {
      continue;
    }

    const meta = result.value.metadata;
    firstArtwork ??= meta.artwork;

    if (meta.tracks && meta.tracks.length > 0) {
      for (const track of meta.tracks) {
        if (!track.streamUrl) {
          continue;
        }
        allTracks.push({
          format: bandcampStreamFormat(track.format),
          name: formatCollectionTrackName(
            meta.artist || meta.name || "",
            track.name
          ),
          streamUrl: track.streamUrl,
          duration: track.duration,
          trackNumber: allTracks.length + 1,
        });
      }
    } else if (meta.streamUrl) {
      allTracks.push({
        format: bandcampStreamFormat(result.value.format),
        name: formatCollectionTrackName(meta.artist || "", meta.name || ""),
        streamUrl: meta.streamUrl,
        duration: meta.duration,
        trackNumber: allTracks.length + 1,
      });
    }
  }

  return { tracks: allTracks, artwork: firstArtwork };
}

async function getBandcampCollection(
  url: string
): Promise<BandcampItemResult | BandcampItemError> {
  const html = await fetchBandcampPage(url);

  const usernameMatch = url.match(USERNAME_RE);
  const username = usernameMatch?.[1] || "Unknown User";

  const fanId = extractFanId(html);

  let collectionItems: CollectionItem[] = [];

  if (fanId) {
    try {
      collectionItems = await fetchCollectionFromApi(fanId);
    } catch (error) {
      console.warn(
        "[Bandcamp] Collection API failed, falling back to HTML parsing:",
        error
      );
    }
  }

  if (collectionItems.length === 0) {
    collectionItems = parseVisibleCollectionItems(html);
  }

  if (collectionItems.length === 0) {
    return createErrorResponse(
      "No collection items found. The collection may be private or empty."
    );
  }

  const urlsToFetch = collectionItems.slice(0, MAX_COLLECTION_ITEMS);
  const results = await Promise.allSettled(
    urlsToFetch.map((item) => getBandcampItem(item.url))
  );

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
    success: true,
    format: allTracks[0]?.format ?? "progressive",
    metadata: {
      platform: "bandcamp",
      itemType: "collection",
      url,
      name: `${username}'s Collection`,
      artist: username,
      artwork,
      trackCount: allTracks.length,
      duration: totalDuration > 0 ? totalDuration : undefined,
      tracks: allTracks,
      streamUrl: allTracks[0]?.streamUrl,
    },
    streamUrl: allTracks[0]?.streamUrl || "",
  };
}
