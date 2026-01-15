import type {
  BandcampItemResult,
  PlatformItemError,
  PlatformItemResponse,
} from "@avoid.quest/radio-shared";
import { load } from "cheerio";
import { decode } from "html-entities";
import { detectBandcampItemType } from "./detect.js";

export { detectBandcampItemType, isBandcampUrl } from "./detect.js";

/**
 * Get the proxied URL for a Bandcamp stream to avoid CORS issues
 * @param url - The Bandcamp stream URL (typically from bcbits.com domain)
 * @returns The proxied URL or the original URL if it's not a Bandcamp URL
 */
export function getProxiedBandcampUrl(url: string): string {
  // Check if this is a Bandcamp URL (bcbits.com domain)
  if (url.includes("bcbits.com")) {
    // Use the proxy endpoint to avoid CORS issues
    return `/api/bandcamp-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

const REQUEST_TIMEOUT_MS = 10_000;

function createErrorResponse(message: string): PlatformItemError {
  return {
    success: false,
    error: message,
  };
}

export async function getBandcampItem(
  url: string
): Promise<PlatformItemResponse> {
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

type BandcampBasicData = {
  name: string;
  byArtist: { name: string };
  image: string;
  inAlbum?: { name: string };
  album?: { image: string };
};

type BandcampExtraData = {
  trackinfo?: BandcampTrackInfo[];
};

type BandcampTrackInfo = {
  title: string;
  file?: { "mp3-128": string };
  duration?: number;
  track_num?: number;
};

async function getBandcampAlbum(
  url: string
): Promise<BandcampItemResult | PlatformItemError> {
  const html = await fetchBandcampPage(url);
  const { basic, extra } = parseBandcampData(html);

  if (!extra.trackinfo || extra.trackinfo.length === 0) {
    return createErrorResponse("No tracks found in album");
  }

  const mappedTracks = extra.trackinfo.map(
    (track: BandcampTrackInfo, index: number) => ({
      name: track.title,
      streamUrl: track.file?.["mp3-128"] || "",
      duration: track.duration,
      trackNumber: track.track_num || index + 1,
    })
  );

  // Filter out tracks without stream URL if necessary, or keep them but they won't play
  // Bandcamp sometimes has tracks without audio (e.g. hidden or pre-order)

  const totalDuration = mappedTracks.reduce(
    (sum: number, track: { duration?: number }) => sum + (track.duration || 0),
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
): Promise<BandcampItemResult | PlatformItemError> {
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
      artwork: basic.image || basic.album?.image, // Fallback to album image if track image is missing
      albumName: basic.inAlbum?.name,
      duration: trackInfo.duration,
      streamUrl: trackInfo.file["mp3-128"],
    },
    streamUrl: trackInfo.file["mp3-128"],
  };
}
