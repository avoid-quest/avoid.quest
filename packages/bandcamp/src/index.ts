import type {
  BandcampItemError,
  BandcampItemResponse,
  BandcampItemResult,
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

export { detectBandcampItemType, isBandcampUrl } from "./detect.js";

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
  if (url.includes("bcbits.com")) {
    return `/api/bandcamp-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

const REQUEST_TIMEOUT_MS = 10_000;

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

  const mappedTracks = extra.trackinfo.map((track, index) => ({
    name: track.title,
    streamUrl: track.file?.["mp3-128"] || "",
    duration: track.duration,
    trackNumber: track.track_num || index + 1,
  }));

  const totalDuration = mappedTracks.reduce(
    (sum, track) => sum + (track.duration || 0),
    0
  );

  return {
    success: true,
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
