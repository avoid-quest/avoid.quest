import type { Radio } from "@/lib/audio";
import type { PlatformMetadata } from "@/lib/platform-types";

function getBandcampDescription(
  metadata: PlatformMetadata
): string | undefined {
  if (metadata.platform !== "bandcamp") {
    return;
  }
  if (metadata.itemType === "album") {
    return metadata.artist || "Bandcamp Album";
  }
  if (metadata.itemType === "track") {
    return metadata.albumName || "Bandcamp Track";
  }
  if (metadata.itemType === "artist") {
    return `${metadata.trackCount ?? 0} tracks`;
  }
  if (metadata.itemType === "collection") {
    return `${metadata.trackCount ?? 0} tracks`;
  }
}

function getSoundCloudDescription(
  metadata: PlatformMetadata
): string | undefined {
  if (metadata.platform !== "soundcloud") {
    return;
  }
  if (metadata.itemType === "track") {
    return metadata.artist || "SoundCloud Track";
  }
  if (metadata.itemType === "playlist") {
    return metadata.artist || "SoundCloud Playlist";
  }
  if (metadata.itemType === "user") {
    return `${metadata.trackCount ?? 0} tracks`;
  }
}

function getYouTubeDescription(metadata: PlatformMetadata): string | undefined {
  if (metadata.platform !== "youtube") {
    return;
  }
  if (metadata.itemType === "video") {
    return metadata.artist || "YouTube Video";
  }
  if (metadata.itemType === "playlist") {
    return metadata.artist || "YouTube Playlist";
  }
}

function getDescription(metadata: PlatformMetadata): string | undefined {
  return (
    getBandcampDescription(metadata) ??
    getSoundCloudDescription(metadata) ??
    getYouTubeDescription(metadata)
  );
}

function getLogoUrl(metadata: PlatformMetadata): string | undefined {
  if (
    metadata.platform === "device-input" ||
    metadata.platform === "local-file" ||
    metadata.platform === "static-audio"
  ) {
    return;
  }
  if (metadata.artwork) {
    return metadata.artwork;
  }
  if (metadata.platform === "bandcamp") {
    return "https://bandcamp.com/img/buttons/bandcamp-button-bc-circle-white-128.png";
  }
  if (metadata.platform === "soundcloud") {
    return "https://a-v2.sndcdn.com/assets/images/sc-icons/white-108x108.png";
  }
  if (metadata.platform === "youtube") {
    return "https://www.youtube.com/s/desktop/bc4637ea/img/favicon_144x144.png";
  }
  return;
}

export function createPlatformRadio(
  streamUrl: string,
  metadata: PlatformMetadata
): Radio {
  const getName = (): string => {
    if (metadata.platform === "device-input") {
      return metadata.deviceLabel;
    }
    if (metadata.platform === "local-file") {
      return metadata.displayName || metadata.fileName || "Local File";
    }
    if (metadata.platform === "static-audio") {
      return metadata.displayName || metadata.fileName || "Audio File";
    }
    return metadata.name || metadata.artist || "Unknown";
  };

  return {
    id: Date.now(),
    name: getName(),
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
      collection: "Collection",
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

  if (metadata.platform === "youtube") {
    const labels: Record<typeof metadata.itemType, string> = {
      video: "Video",
      playlist: "Playlist",
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

  // Platform radios (SoundCloud/Bandcamp/YouTube) only work in DJ mode
  if (isPlatformRadio(radio) && mode !== "dj") {
    const platformNames: Record<string, string> = {
      bandcamp: "Bandcamp",
      soundcloud: "SoundCloud",
      youtube: "YouTube",
    };
    const platform =
      platformNames[radio.platformMetadata?.platform ?? ""] ?? "External";
    throw new PlatformModeError(platform, mode);
  }
}
