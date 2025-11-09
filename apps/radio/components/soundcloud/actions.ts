"use server";

import { fetchClientID } from "@scdl/fetch-client";
import { setClientID, stream } from "scdl-core";
import type {
  PlatformItemError,
  PlatformItemResponse,
  SoundCloudItemResult,
  SoundCloudItemType,
  SoundCloudMetadata,
} from "@/lib/external-url/types";

const SOUNDCLOUD_TRACK_PATTERN = /soundcloud\.com\/[^/]+\/[^/]+/i;
const SOUNDCLOUD_PLAYLIST_PATTERN = /soundcloud\.com\/[^/]+\/sets\/[^/]+/i;

function detectSoundCloudItemType(url: string): SoundCloudItemType {
  if (SOUNDCLOUD_PLAYLIST_PATTERN.test(url)) {
    return "playlist";
  }
  if (SOUNDCLOUD_TRACK_PATTERN.test(url)) {
    return "track";
  }
  return "user";
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
    // Initialize client ID for future API calls
    const clientID = await fetchClientID();
    setClientID(clientID);

    // The stream function returns a stream, not metadata
    // For now, we'll create basic metadata from the URL
    // Metadata extraction can be enhanced later with proper API calls
    const metadata: SoundCloudMetadata = {
      platform: "soundcloud",
      itemType: "track",
      url,
      streamUrl: url, // Use original URL as stream URL for SoundCloud
    };

    // For now, we'll use the original URL as the stream URL
    // The actual streaming will be handled by the player
    return {
      success: true,
      metadata,
      streamUrl: url,
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

function getSoundCloudPlaylist(
  _url: string
): Promise<SoundCloudItemResult | PlatformItemError> {
  // For playlists, we'll need to fetch the playlist info
  // Since scdl-core may not have direct playlist support,
  // we'll return the first track URL for now
  // This can be expanded when we have better API access

  return Promise.resolve({
    success: false,
    error: "Playlist support is not yet fully implemented",
  } as PlatformItemError);
}

export async function getSoundCloudStreamUrl(url: string): Promise<string> {
  try {
    const clientID = await fetchClientID();
    setClientID(clientID);

    const streamResult = await stream(url);

    // Convert the stream to a Buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of streamResult) {
      chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    }

    // Combine all chunks into a single buffer
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Convert to base64
    const base64 = Buffer.from(combined).toString("base64");

    // Determine content type from transcoding if available
    const contentType =
      streamResult.transcoding?.format.mime_type || "audio/mpeg";

    // Return as data URL
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error("Error streaming SoundCloud track:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to stream SoundCloud track: ${errorMessage}`);
  }
}
