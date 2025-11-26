import type { Platform, PlatformMetadata } from "./types";

/**
 * Check if a platform item is a collection (album/playlist)
 */
export function isCollection(metadata: PlatformMetadata): boolean {
  return (
    (metadata.platform === "bandcamp" && metadata.itemType === "album") ||
    (metadata.platform === "soundcloud" && metadata.itemType === "playlist")
  );
}

/**
 * Get the current track index in a collection
 */
export function getCurrentTrackIndex(
  metadata: PlatformMetadata,
  currentStreamUrl: string
): number {
  if (!(isCollection(metadata) && metadata.tracks)) {
    return 0;
  }

  const index = metadata.tracks.findIndex(
    (t) => t.streamUrl === currentStreamUrl
  );
  return index !== -1 ? index : 0;
}

/**
 * Get human-readable item type label
 */
export function getItemTypeLabel(
  platform: Platform | null,
  itemType?: string
): string | null {
  if (!(platform && itemType)) {
    return null;
  }

  if (platform === "bandcamp") {
    const labels: Record<string, string> = {
      album: "Album",
      track: "Track",
      artist: "Artist",
      label: "Label",
    };
    return labels[itemType] ?? null;
  }

  if (platform === "soundcloud") {
    const labels: Record<string, string> = {
      track: "Track",
      playlist: "Playlist/Set",
      user: "User",
    };
    return labels[itemType] ?? null;
  }

  return null;
}

/**
 * Get platform display name
 */
export function getPlatformLabel(platform: Platform): string {
  return platform === "bandcamp" ? "Bandcamp" : "SoundCloud";
}

/**
 * Get placeholder text for platform URL input
 */
export function getUrlPlaceholder(platform: Platform): string {
  if (platform === "bandcamp") {
    return "https://artist.bandcamp.com/track/song-name";
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
  return "Example: https://soundcloud.com/artist/sets/playlist-name";
}
