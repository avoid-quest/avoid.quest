import { detectBandcampItemType } from "@/lib/external-url/detect";
import type {
  BandcampItemResult,
  PlatformItemError,
  PlatformItemResponse,
} from "@/lib/external-url/types";

function createErrorResponse(message: string): PlatformItemError {
  return {
    success: false,
    error: message,
  };
}

// Lazy loader for bandcamp-fetch to avoid global scope execution issues in Cloudflare Workers
// Module is externalized via Vite plugin in vite.config.ts, so it's only loaded dynamically
// at runtime within handler context, not during bundle initialization
async function loadBandcampFetch() {
  const module = await import("bandcamp-fetch");
  return module.default;
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

async function getBandcampAlbum(
  url: string
): Promise<BandcampItemResult | PlatformItemError> {
  const bcfetch = await loadBandcampFetch();
  const album = await bcfetch.album.getInfo({
    albumUrl: url,
    albumImageFormat: "art_app_large",
    artistImageFormat: "bio_featured",
    includeRawData: false,
  });

  if (!album?.tracks || album.tracks.length === 0) {
    return createErrorResponse("No tracks found in album");
  }

  const mappedTracks = album.tracks.map(
    (
      track: { name?: string; streamUrl?: string; duration?: number },
      index: number
    ) => ({
      name: track.name || `Track ${index + 1}`,
      streamUrl: track.streamUrl || "",
      duration: track.duration,
      trackNumber: index + 1,
    })
  );

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
      name: album.name,
      artist: album.artist?.name,
      artwork: album.imageUrl,
      albumName: album.name,
      trackCount: mappedTracks.length,
      duration: totalDuration > 0 ? totalDuration : undefined,
      tracks: mappedTracks,
      streamUrl: album.tracks[0]?.streamUrl,
    },
    streamUrl: album.tracks[0]?.streamUrl || "",
  };
}

async function getBandcampTrack(
  url: string
): Promise<BandcampItemResult | PlatformItemError> {
  const bcfetch = await loadBandcampFetch();
  const track = await bcfetch.track.getInfo({
    trackUrl: url,
    albumImageFormat: "art_app_large",
    artistImageFormat: "bio_featured",
    includeRawData: false,
  });

  if (!track?.streamUrl) {
    return createErrorResponse("No stream URL found for track");
  }

  return {
    success: true,
    metadata: {
      platform: "bandcamp",
      itemType: "track",
      url,
      name: track.name,
      artist: track.artist?.name,
      artwork: track.imageUrl || track.album?.imageUrl,
      albumName: track.album?.name,
      duration: track.duration,
      streamUrl: track.streamUrl,
    },
    streamUrl: track.streamUrl,
  };
}
