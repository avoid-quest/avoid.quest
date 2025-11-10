"use server";

import { fetchClientID } from "@scdl/fetch-client";
import type { PlaylistInfo, TrackInfoData } from "scdl-core";
import {
  getClientID,
  getInfo,
  getPlaylistInfo,
  setClientID,
  stream,
} from "scdl-core";
import { detectSoundCloudItemType } from "@/lib/external-url/detect";
import type {
  PlatformItemError,
  PlatformItemResponse,
  SoundCloudItemResult,
  SoundCloudMetadata,
} from "@/lib/external-url/types";

function createErrorResponse(message: string): PlatformItemError {
  return {
    success: false,
    error: message,
  };
}

async function resolveSoundCloudStreamUrl(
  trackUrl: string
): Promise<string | null> {
  try {
    const streamResult = await stream(trackUrl);
    const transcodingUrl = streamResult.transcoding?.url;

    if (!transcodingUrl) {
      return null;
    }

    const currentClientID = getClientID();
    const resolveUrl = currentClientID
      ? `${transcodingUrl}${transcodingUrl.includes("?") ? "&" : "?"}client_id=${currentClientID}`
      : transcodingUrl;

    const resolveResponse = await fetch(resolveUrl);
    if (!resolveResponse.ok) {
      return null;
    }

    const resolveData = (await resolveResponse.json()) as { url: string };
    const streamUrl = resolveData.url;
    return `/api/soundcloud-proxy?url=${encodeURIComponent(streamUrl)}`;
  } catch {
    return null;
  }
}

export async function getSoundCloudItem(
  url: string
): Promise<PlatformItemResponse> {
  try {
    const itemType = detectSoundCloudItemType(url);

    if (itemType === "track") {
      return await getSoundCloudTrack(url);
    }
    if (itemType === "playlist") {
      return await getSoundCloudPlaylist(url);
    }

    return createErrorResponse("User pages are not yet supported");
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return createErrorResponse(
      `Failed to get SoundCloud item: ${errorMessage}`
    );
  }
}

async function getSoundCloudTrack(
  url: string
): Promise<SoundCloudItemResult | PlatformItemError> {
  try {
    const clientID = await fetchClientID();
    setClientID(clientID);

    const trackInfo = await getInfo(url);
    const track = trackInfo.data;

    const proxyUrl = await resolveSoundCloudStreamUrl(url);
    if (!proxyUrl) {
      return createErrorResponse("No stream URL available for this track");
    }

    const metadata: SoundCloudMetadata = {
      platform: "soundcloud",
      itemType: "track",
      url,
      name: track.title,
      artist: track.user.username,
      artwork:
        track.artwork_url?.replace("-large", "-t500x500") || track.artwork_url,
      duration: Math.floor(track.duration / 1000),
      streamUrl: proxyUrl,
    };

    return {
      success: true,
      metadata,
      streamUrl: proxyUrl,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return createErrorResponse(
      `Failed to get SoundCloud track: ${errorMessage}`
    );
  }
}

async function getSoundCloudPlaylist(
  url: string
): Promise<SoundCloudItemResult | PlatformItemError> {
  try {
    const clientID = await fetchClientID();
    setClientID(clientID);

    const playlistInfo: PlaylistInfo = await getPlaylistInfo(url);
    const fetchedPlaylist = await playlistInfo.fetchPartialTracks();
    const playlist = fetchedPlaylist.data;

    if (!playlist.tracks || playlist.tracks.length === 0) {
      return createErrorResponse("No tracks found in playlist");
    }

    const processedTracks = await Promise.all(
      playlist.tracks.map(async (track: TrackInfoData) => {
        const proxyUrl = await resolveSoundCloudStreamUrl(track.permalink_url);
        return {
          name: track.title,
          streamUrl: proxyUrl || "",
          duration: Math.floor(track.duration / 1000),
        };
      })
    );

    const validTracks = processedTracks.filter((t) => t.streamUrl);

    if (validTracks.length === 0) {
      return createErrorResponse("No playable tracks found in playlist");
    }

    const firstTrackStreamUrl = validTracks[0]?.streamUrl || "";

    const metadata: SoundCloudMetadata = {
      platform: "soundcloud",
      itemType: "playlist",
      url,
      name: playlist.title,
      artist: playlist.user.username,
      artwork:
        playlist.artwork_url?.replace("-large", "-t500x500") ||
        playlist.artwork_url,
      duration: Math.floor(playlist.duration / 1000),
      trackCount: playlist.track_count,
      tracks: validTracks,
      streamUrl: firstTrackStreamUrl,
    };

    return {
      success: true,
      metadata,
      streamUrl: firstTrackStreamUrl,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return createErrorResponse(
      `Failed to get SoundCloud playlist: ${errorMessage}`
    );
  }
}
