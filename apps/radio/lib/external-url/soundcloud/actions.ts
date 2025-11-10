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

    return {
      success: false,
      error: "User pages are not yet supported",
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      success: false,
      error: `Failed to get SoundCloud item: ${errorMessage}`,
    };
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

    // Get stream URL using scdl-core's stream function
    const streamResult = await stream(url);
    const transcodingUrl = streamResult.transcoding?.url;

    if (!transcodingUrl) {
      return {
        success: false,
        error: "No stream URL available for this track",
      };
    }

    // Resolve the transcoding URL to get the actual stream URL
    // The transcoding URL needs the client ID as a query parameter
    const currentClientID = getClientID();
    const resolveUrl = currentClientID
      ? `${transcodingUrl}${transcodingUrl.includes("?") ? "&" : "?"}client_id=${currentClientID}`
      : transcodingUrl;
    const resolveResponse = await fetch(resolveUrl);
    if (!resolveResponse.ok) {
      return {
        success: false,
        error: `Failed to resolve stream URL: ${resolveResponse.statusText}`,
      };
    }
    const resolveData = (await resolveResponse.json()) as { url: string };
    const streamUrl = resolveData.url;

    const proxyUrl = `/api/soundcloud-proxy?url=${encodeURIComponent(streamUrl)}`;

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
    return {
      success: false,
      error: `Failed to get SoundCloud track: ${errorMessage}`,
    };
  }
}

async function getSoundCloudPlaylist(
  url: string
): Promise<SoundCloudItemResult | PlatformItemError> {
  try {
    // Initialize client ID for future API calls
    const clientID = await fetchClientID();
    setClientID(clientID);

    // Get playlist info
    const playlistInfo: PlaylistInfo = await getPlaylistInfo(url);

    // Fetch partial tracks if needed to get full track data
    const fetchedPlaylist = await playlistInfo.fetchPartialTracks();
    const playlist = fetchedPlaylist.data;

    if (!playlist.tracks || playlist.tracks.length === 0) {
      return {
        success: false,
        error: "No tracks found in playlist",
      };
    }

    // Process tracks to get their stream URLs and metadata
    const processedTracks = await Promise.all(
      playlist.tracks.map(async (track: TrackInfoData) => {
        try {
          const streamResult = await stream(track.permalink_url);
          const transcodingUrl = streamResult.transcoding?.url;

          if (!transcodingUrl) {
            return {
              name: track.title,
              streamUrl: "",
              duration: Math.floor(track.duration / 1000),
            };
          }

          // Resolve the transcoding URL to get the actual stream URL
          const currentClientID = getClientID();
          const resolveUrl = currentClientID
            ? `${transcodingUrl}${transcodingUrl.includes("?") ? "&" : "?"}client_id=${currentClientID}`
            : transcodingUrl;
          const resolveResponse = await fetch(resolveUrl);
          if (!resolveResponse.ok) {
            return {
              name: track.title,
              streamUrl: "",
              duration: Math.floor(track.duration / 1000),
            };
          }
          const resolveData = (await resolveResponse.json()) as { url: string };
          const streamUrl = resolveData.url;

          const proxyUrl = `/api/soundcloud-proxy?url=${encodeURIComponent(streamUrl)}`;

          return {
            name: track.title,
            streamUrl: proxyUrl,
            duration: Math.floor(track.duration / 1000),
          };
        } catch {
          return {
            name: track.title,
            streamUrl: "",
            duration: Math.floor(track.duration / 1000),
          };
        }
      })
    );

    // Filter out tracks without stream URLs
    const validTracks = processedTracks.filter((t) => t.streamUrl);

    if (validTracks.length === 0) {
      return {
        success: false,
        error: "No playable tracks found in playlist",
      };
    }

    // Get stream URL for the first track
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
      duration: Math.floor(playlist.duration / 1000), // Convert from milliseconds to seconds
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
    return {
      success: false,
      error: `Failed to get SoundCloud playlist: ${errorMessage}`,
    };
  }
}

export async function getSoundCloudStreamUrl(url: string): Promise<string> {
  const clientID = await fetchClientID();
  setClientID(clientID);

  const streamResult = await stream(url);
  const transcodingUrl = streamResult.transcoding?.url;

  if (!transcodingUrl) {
    throw new Error("No stream URL available for this track");
  }

  // Resolve the transcoding URL to get the actual stream URL
  // The transcoding URL needs the client ID as a query parameter
  const currentClientID = getClientID();
  const resolveUrl = currentClientID
    ? `${transcodingUrl}${transcodingUrl.includes("?") ? "&" : "?"}client_id=${currentClientID}`
    : transcodingUrl;
  const resolveResponse = await fetch(resolveUrl);
  if (!resolveResponse.ok) {
    throw new Error(
      `Failed to resolve stream URL: ${resolveResponse.statusText}`
    );
  }
  const resolveData = (await resolveResponse.json()) as { url: string };
  const streamUrl = resolveData.url;

  return `/api/soundcloud-proxy?url=${encodeURIComponent(streamUrl)}`;
}

export async function getSoundCloudPlaylistUrl(
  url: string
): Promise<string | undefined> {
  const result = await getSoundCloudPlaylist(url);
  if (result.success) {
    return result.streamUrl;
  }
  return;
}
