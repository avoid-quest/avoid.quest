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

  const index = metadata.tracks.findIndex(
    (t: { streamUrl: string }) => t.streamUrl === currentStreamUrl
  );
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
