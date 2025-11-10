"use server";

import bcfetch from "bandcamp-fetch";
import type {
  BandcampItemResult,
  BandcampItemType,
  BandcampMetadata,
  PlatformItemError,
  PlatformItemResponse,
} from "@/lib/external-url/types";

const BANDCAMP_ALBUM_PATTERN = /bandcamp\.com\/album\//i;
const BANDCAMP_TRACK_PATTERN = /bandcamp\.com\/track\//i;

function detectBandcampItemType(url: string): BandcampItemType {
  if (BANDCAMP_ALBUM_PATTERN.test(url)) {
    return "album";
  }
  if (BANDCAMP_TRACK_PATTERN.test(url)) {
    return "track";
  }
  return "artist";
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

    return {
      success: false,
      error: "Artist pages are not yet supported",
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      success: false,
      error: `Failed to get Bandcamp item: ${errorMessage}`,
    };
  }
}

async function getBandcampAlbum(
  url: string
): Promise<BandcampItemResult | PlatformItemError> {
  try {
    const params = {
      albumUrl: url,
      albumImageFormat: "art_app_large",
      artistImageFormat: "bio_featured",
      includeRawData: false,
    };

    const album = await bcfetch.album.getInfo(params);
    if (!album?.tracks || album.tracks.length === 0) {
      return {
        success: false,
        error: "No tracks found in album",
      };
    }

    const mappedTracks = album.tracks.map((track, index) => ({
      name: track.name || `Track ${index + 1}`,
      streamUrl: track.streamUrl || "",
      duration: track.duration,
      trackNumber: index + 1,
    }));

    // Calculate total duration from all tracks
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
    return {
      success: false,
      error: `Failed to get Bandcamp album: ${errorMessage}`,
    };
  }
}

async function getBandcampTrack(
  url: string
): Promise<BandcampItemResult | PlatformItemError> {
  try {
    const params = {
      trackUrl: url,
      albumImageFormat: "art_app_large",
      artistImageFormat: "bio_featured",
      includeRawData: false,
    };

    const track = await bcfetch.track.getInfo(params);
    if (!track?.streamUrl) {
      return {
        success: false,
        error: "No stream URL found for track",
      };
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
    return {
      success: false,
      error: `Failed to get Bandcamp track: ${errorMessage}`,
    };
  }
}

export async function getBandcampAlbunUrl(
  url: string
): Promise<string | undefined> {
  const result = await getBandcampAlbum(url);
  if (result.success) {
    return result.streamUrl;
  }
  return;
}

export async function getBandcampTrackUrl(
  url: string
): Promise<string | undefined> {
  const result = await getBandcampTrack(url);
  if (result.success) {
    return result.streamUrl;
  }
  return;
}
