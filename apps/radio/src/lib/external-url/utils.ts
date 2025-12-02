import type { PlatformMetadata } from "@avoid.quest/radio-shared";
import type { Radio } from "@/lib/types";

function getDescription(metadata: PlatformMetadata): string | undefined {
  if (metadata.platform === "bandcamp") {
    if (metadata.itemType === "album") {
      return metadata.artist || "Bandcamp Album";
    }
    if (metadata.itemType === "track") {
      return metadata.albumName || "Bandcamp Track";
    }
    return;
  }
  if (metadata.platform === "soundcloud") {
    if (metadata.itemType === "track" || metadata.itemType === "playlist") {
      return (
        metadata.artist ||
        (metadata.itemType === "track"
          ? "SoundCloud Track"
          : "SoundCloud Playlist")
      );
    }
    return;
  }
  return;
}

function getLogoUrl(metadata: PlatformMetadata): string | undefined {
  if (metadata.artwork) {
    return metadata.artwork;
  }
  if (metadata.platform === "bandcamp") {
    return "https://bandcamp.com/img/buttons/bandcamp-button-bc-circle-white-128.png";
  }
  if (metadata.platform === "soundcloud") {
    return "https://a-v2.sndcdn.com/assets/images/sc-icons/white-108x108.png";
  }
  return;
}

export function createPlatformRadio(
  streamUrl: string,
  metadata: PlatformMetadata
): Radio {
  return {
    id: Date.now(),
    name: metadata.name || metadata.artist || "Unknown",
    streamUrl,
    logoUrl: getLogoUrl(metadata),
    description: getDescription(metadata),
    websiteUrl: metadata.url,
    platformMetadata: metadata,
    enabled: true,
  };
}

/**
 * Check if a radio item is from an external platform (Bandcamp/SoundCloud)
 */
export function isPlatformRadio(radio: Radio | null): boolean {
  return radio?.platformMetadata !== undefined;
}

/**
 * Get human-friendly label for platform item type
 */
export function getPlatformItemTypeLabel(metadata: PlatformMetadata): string {
  if (metadata.platform === "bandcamp") {
    const labels: Record<typeof metadata.itemType, string> = {
      album: "Album",
      track: "Track",
      artist: "Artist",
      label: "Label",
    };
    return labels[metadata.itemType];
  }

  if (metadata.platform === "soundcloud") {
    const labels: Record<typeof metadata.itemType, string> = {
      track: "Track",
      playlist: "Playlist",
      user: "User",
    };
    return labels[metadata.itemType];
  }

  return "Unknown";
}

/**
 * Format duration in seconds to MM:SS format
 */
export function formatPlatformDuration(seconds?: number): string {
  if (!seconds) {
    return "";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
