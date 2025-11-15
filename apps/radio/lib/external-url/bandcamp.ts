"use server";

import { detectBandcampItemType } from "@/lib/external-url/detect";
import type {
  BandcampItemResult,
  BandcampMetadata,
  PlatformItemError,
  PlatformItemResponse,
} from "@/lib/external-url/types";

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

async function getBandcampAlbum(
  url: string
): Promise<BandcampItemResult | PlatformItemError> {
  try {
    const bcfetch = (await import("bandcamp-fetch")).default;
    const params = {
      albumUrl: url,
      albumImageFormat: "art_app_large",
      artistImageFormat: "bio_featured",
      includeRawData: false,
    };

    const album = await bcfetch.album.getInfo(params);
    if (!album?.tracks || album.tracks.length === 0) {
      return createErrorResponse("No tracks found in album");
    }

    const mappedTracks = album.tracks.map((track, index) => ({
      name: track.name || `Track ${index + 1}`,
      streamUrl: track.streamUrl || "",
      duration: track.duration,
      trackNumber: index + 1,
    }));

    const totalDuration = mappedTracks.reduce(
      (sum, track) => sum + (track.duration || 0),
      0
    );

    const metadata: BandcampMetadata = {
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
    };

    return {
      success: true,
      metadata,
      streamUrl: album.tracks[0]?.streamUrl || "",
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return createErrorResponse(`Failed to get Bandcamp album: ${errorMessage}`);
  }
}

async function getBandcampTrack(
  url: string
): Promise<BandcampItemResult | PlatformItemError> {
  try {
    const bcfetch = (await import("bandcamp-fetch")).default;
    const params = {
      trackUrl: url,
      albumImageFormat: "art_app_large",
      artistImageFormat: "bio_featured",
      includeRawData: false,
    };

    const track = await bcfetch.track.getInfo(params);
    if (!track?.streamUrl) {
      return createErrorResponse("No stream URL found for track");
    }

    const metadata: BandcampMetadata = {
      platform: "bandcamp",
      itemType: "track",
      url,
      name: track.name,
      artist: track.artist?.name,
      artwork: track.imageUrl || track.album?.imageUrl,
      albumName: track.album?.name,
      duration: track.duration,
      streamUrl: track.streamUrl,
    };

    return {
      success: true,
      metadata,
      streamUrl: track.streamUrl,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return createErrorResponse(`Failed to get Bandcamp track: ${errorMessage}`);
  }
}
