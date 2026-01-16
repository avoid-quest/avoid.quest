import type { Radio } from "@/lib/audio";
import type { PlatformMetadata } from "@/lib/platform-types";

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

/**
 * Platform radio mode restriction error
 */
export class PlatformModeError extends Error {
  readonly platform: string;
  readonly mode: string;

  constructor(platform: string, mode: string) {
    super(
      `${platform} tracks are only supported in DJ mode. Switch to DJ mode to play this track.`
    );
    this.name = "PlatformModeError";
    this.platform = platform;
    this.mode = mode;
  }
}

/**
 * Validate that a radio can be played in the given mode
 * @param radio The radio to validate
 * @param mode Current player mode ("single", "multiple", or "dj")
 * @throws PlatformModeError if the radio is a platform track and mode is not "dj"
 */
export function validateRadioForMode(
  radio: Radio | null,
  mode: "single" | "multiple" | "dj"
): void {
  if (!radio) {
    return;
  }

  // Platform radios (SoundCloud/Bandcamp) only work in DJ mode
  if (isPlatformRadio(radio) && mode !== "dj") {
    const platform =
      radio.platformMetadata?.platform === "bandcamp"
        ? "Bandcamp"
        : "SoundCloud";
    throw new PlatformModeError(platform, mode);
  }
}
