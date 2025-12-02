import type {
  BandcampItemResult,
  PlatformItemError,
  PlatformItemResponse,
} from "@avoid.quest/radio-shared";
import { load } from "cheerio";
import { decode } from "html-entities";
import { detectBandcampItemType } from "./detect";

export { detectBandcampItemType, isBandcampUrl } from "./detect";

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

    return createErrorResponse("Artist pages are not yet supported");
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return createErrorResponse(`Failed to get Bandcamp item: ${errorMessage}`);
  }
}

async function fetchBandcampPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Bandcamp page: ${response.statusText}`);
  }

  return await response.text();
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

  const basic = JSON.parse(rawBasic);
  const extra = JSON.parse(decode(rawExtra));

  return { basic, extra };
}

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
