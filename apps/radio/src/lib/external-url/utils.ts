import type { Radio } from "@/lib/audio";
import type { PlaybackSessionId } from "@/lib/collections/playback-sessions";
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

function getMixcloudDescription(
  metadata: PlatformMetadata
): string | undefined {
  if (metadata.platform !== "mixcloud") {
    return;
  }
  return metadata.artist || "Mixcloud Show";
}

function getSpotifyDescription(metadata: PlatformMetadata): string | undefined {
  if (metadata.platform !== "spotify") {
    return;
  }
  const labels = {
    album: "Spotify Album",
    playlist: "Spotify Playlist",
    track: "Spotify Track",
  } as const;
  return metadata.artist || labels[metadata.itemType];
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

function getRadioGardenDescription(
  metadata: PlatformMetadata
): string | undefined {
  if (metadata.platform !== "radiogarden") {
    return;
  }
  return metadata.subtitle || "Radio Station";
}

function getRadioBrowserDescription(
  metadata: PlatformMetadata
): string | undefined {
  if (metadata.platform !== "radio-browser") {
    return;
  }
  return "Radio Station";
}

function getDescription(metadata: PlatformMetadata): string | undefined {
  return (
    getBandcampDescription(metadata) ??
    getMixcloudDescription(metadata) ??
    getRadioBrowserDescription(metadata) ??
    getRadioGardenDescription(metadata) ??
    getSoundCloudDescription(metadata) ??
    getSpotifyDescription(metadata) ??
    getYouTubeDescription(metadata)
  );
}

function getLogoUrl(metadata: PlatformMetadata): string | undefined {
  if (
    metadata.platform === "device-input" ||
    metadata.platform === "local-file" ||
    metadata.platform === "radio-browser" ||
    metadata.platform === "static-audio" ||
    metadata.platform === "radiogarden"
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
}

export function createPlatformRadio(
  streamUrl: string,
  metadata: PlatformMetadata,
  streamFormat?: Radio["streamFormat"]
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
    if (metadata.platform === "radiogarden") {
      return metadata.name || "Radio Station";
    }
    if (metadata.platform === "radio-browser") {
      return "Radio Station";
    }
    return metadata.name || metadata.artist || "Unknown";
  };

  return {
    id: Date.now(),
    name: getName(),
    streamUrl,
    ...(streamFormat ? { streamFormat } : {}),
    description: getDescription(metadata),
    enabled: true,
    logoUrl: getLogoUrl(metadata),
    platformMetadata: metadata,
    websiteUrl: metadata.url,
  };
}

/**
 * Check if a radio item has platform metadata (any external platform or device input)
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
      artist: "Artist",
      collection: "Collection",
      label: "Label",
      track: "Track",
    };
    return labels[metadata.itemType];
  }

  if (metadata.platform === "soundcloud") {
    const labels: Record<typeof metadata.itemType, string> = {
      playlist: "Playlist",
      track: "Track",
      user: "User",
    };
    return labels[metadata.itemType];
  }

  if (metadata.platform === "mixcloud") {
    return "Show";
  }

  if (metadata.platform === "spotify") {
    const labels: Record<typeof metadata.itemType, string> = {
      album: "Album",
      playlist: "Playlist",
      track: "Track",
    };
    return labels[metadata.itemType];
  }

  if (metadata.platform === "radiogarden") {
    return "Radio Station";
  }

  if (metadata.platform === "radio-browser") {
    return "Radio Station";
  }

  if (metadata.platform === "youtube") {
    const labels: Record<typeof metadata.itemType, string> = {
      playlist: "Playlist",
      video: "Video",
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
      `${platform} tracks play in DJ and Node modes. Switch to one of them to play this track.`
    );
    this.name = "PlatformModeError";
    this.platform = platform;
    this.mode = mode;
  }
}

/**
 * Validate that a radio can be played in the given mode
 * @param radio The radio to validate
 * @param mode Playback session the radio would play in
 * @throws PlatformModeError if the radio is a platform track and mode is
 * Single; DJ decks and Node mode's Track nodes play them
 */
export function validateRadioForMode(
  radio: Radio | null,
  mode: PlaybackSessionId
): void {
  if (!radio) {
    return;
  }

  // Platform radios (SoundCloud/Bandcamp/YouTube/Mixcloud/Spotify) need a
  // stream refresh when their URL expires, which DJ decks and Node lanes run
  // and Single does not. Radio Garden stations are live streams — they work
  // in all modes
  const djOnlyPlatforms: Record<string, string> = {
    bandcamp: "Bandcamp",
    mixcloud: "Mixcloud",
    soundcloud: "SoundCloud",
    spotify: "Spotify",
    youtube: "YouTube",
  };
  const platformKey = radio.platformMetadata?.platform ?? "";
  if (
    isPlatformRadio(radio) &&
    mode !== "dj" &&
    mode !== "node" &&
    platformKey in djOnlyPlatforms
  ) {
    const platform = djOnlyPlatforms[platformKey] ?? "External";
    throw new PlatformModeError(platform, mode);
  }
}
