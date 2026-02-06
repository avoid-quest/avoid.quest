import type { Platform, PlatformMetadata } from "@/lib/platform-types";

/**
 * Check if a platform item is a collection (album/playlist)
 */
export function isCollection(metadata: PlatformMetadata): boolean {
  return (
    (metadata.platform === "bandcamp" && metadata.itemType === "album") ||
    (metadata.platform === "soundcloud" && metadata.itemType === "playlist") ||
    (metadata.platform === "youtube" && metadata.itemType === "playlist")
  );
}

/**
 * Get the current track index in a collection
 */
export function getCurrentTrackIndex(
  metadata: PlatformMetadata,
  currentStreamUrl: string
): number {
  if (
    metadata.platform === "device-input" ||
    metadata.platform === "local-file"
  ) {
    return 0;
  }
  if (!(isCollection(metadata) && metadata.tracks)) {
    return 0;
  }

  // First try direct streamUrl match
  let index = metadata.tracks.findIndex(
    (t: { streamUrl: string }) => t.streamUrl === currentStreamUrl
  );
  if (index !== -1) {
    return index;
  }

  // For YouTube, also match by videoId since resolved URLs differ from yt:{id} format
  if (metadata.platform === "youtube") {
    // Check if currentStreamUrl is a yt:{videoId} format
    if (currentStreamUrl.startsWith("yt:")) {
      const videoId = currentStreamUrl.slice(3);
      index = metadata.tracks.findIndex(
        (t) => "videoId" in t && t.videoId === videoId
      );
    } else {
      // Current URL is resolved - find track whose streamUrl was updated to this URL
      // or whose videoId matches a track that was resolved
      index = metadata.tracks.findIndex(
        (t) => t.streamUrl === currentStreamUrl
      );
    }
  }

  return index !== -1 ? index : 0;
}

/**
 * Get placeholder text for platform URL input
 */
export function getUrlPlaceholder(platform: Platform): string {
  if (platform === "bandcamp") {
    return "https://artist.bandcamp.com/track/song-name";
  }
  if (platform === "youtube") {
    return "https://youtube.com/watch?v=dQw4w9WgXcQ";
  }
  return "https://soundcloud.com/artist/track-name";
}

/**
 * Get example URL text for platform
 */
export function getUrlExample(platform: Platform): string {
  if (platform === "bandcamp") {
    return "Example: https://artist.bandcamp.com/album/album-name";
  }
  if (platform === "youtube") {
    return "Example: https://youtube.com/playlist?list=PLxxxxxxxx";
  }
  return "Example: https://soundcloud.com/artist/sets/playlist-name";
}
