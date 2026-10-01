import { isCollection } from "@/lib/external-url/metadata-helpers";
import type {
  BandcampMetadata,
  Platform,
  PlatformMetadata,
  SoundCloudMetadata,
  SpotifyMetadata,
  StaticAudioMetadata,
  YouTubeMetadata,
} from "@/lib/platform-types";

export type DeckPanelContentKind =
  | "empty"
  | "loaded"
  | "pending-browser"
  | "pending-device"
  | "pending-external"
  | "pending-file";

export function resolveDeckPanelContentKind(
  hasRadio: boolean,
  pendingPlatform?: Platform
): DeckPanelContentKind {
  // Spotify has no search, so its pending tile still shares a tab.
  if (
    pendingPlatform === "browser-audio" ||
    pendingPlatform === "spotify" ||
    pendingPlatform === "radio-shows"
  ) {
    return "pending-browser";
  }
  if (pendingPlatform === "device-input") {
    return "pending-device";
  }
  if (pendingPlatform === "local-file" || pendingPlatform === "static-audio") {
    return "pending-file";
  }
  if (
    pendingPlatform === "external" ||
    pendingPlatform === "bandcamp" ||
    pendingPlatform === "mixcloud" ||
    pendingPlatform === "soundcloud" ||
    pendingPlatform === "youtube" ||
    pendingPlatform === "radiogarden"
  ) {
    return "pending-external";
  }
  return hasRadio ? "loaded" : "empty";
}

/** Metadata that can list tracks; a Mixcloud show is one recording. */
export function isStreamingMetadata(
  metadata?: PlatformMetadata
): metadata is
  | BandcampMetadata
  | SoundCloudMetadata
  | SpotifyMetadata
  | StaticAudioMetadata
  | YouTubeMetadata {
  return (
    metadata !== undefined &&
    (metadata.platform === "bandcamp" ||
      metadata.platform === "soundcloud" ||
      metadata.platform === "spotify" ||
      metadata.platform === "static-audio" ||
      metadata.platform === "youtube")
  );
}

export function calculateHasTracklist(metadata?: PlatformMetadata): boolean {
  return (
    isStreamingMetadata(metadata) &&
    Boolean(metadata.tracks && metadata.tracks.length > 0) &&
    isCollection(metadata)
  );
}

/**
 * The search "Change source" opens for a loaded item, or null when it should
 * open the Stations picker instead (stations, directory stations, devices).
 * Spotify has no search of its own: every platform's opens, where another
 * Spotify link can be pasted.
 */
export function getChangeSourceSearchPlatform(
  metadata?: PlatformMetadata
): "all" | "bandcamp" | "mixcloud" | "soundcloud" | "youtube" | null {
  const platform = metadata?.platform;
  if (platform === "spotify") {
    return "all";
  }
  return platform === "bandcamp" ||
    platform === "mixcloud" ||
    platform === "soundcloud" ||
    platform === "youtube"
    ? platform
    : null;
}
