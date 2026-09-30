import { isCollection } from "@/lib/external-url/metadata-helpers";
import type {
  BandcampMetadata,
  Platform,
  PlatformMetadata,
  SoundCloudMetadata,
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
  if (
    pendingPlatform === "browser-audio" ||
    pendingPlatform === "spotify" ||
    pendingPlatform === "mixcloud" ||
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
    pendingPlatform === "soundcloud" ||
    pendingPlatform === "youtube" ||
    pendingPlatform === "radiogarden"
  ) {
    return "pending-external";
  }
  return hasRadio ? "loaded" : "empty";
}

export function isStreamingMetadata(
  metadata?: PlatformMetadata
): metadata is
  | BandcampMetadata
  | SoundCloudMetadata
  | StaticAudioMetadata
  | YouTubeMetadata {
  return (
    metadata !== undefined &&
    (metadata.platform === "bandcamp" ||
      metadata.platform === "soundcloud" ||
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
 */
export function getChangeSourceSearchPlatform(
  metadata?: PlatformMetadata
): "bandcamp" | "soundcloud" | "youtube" | null {
  const platform = metadata?.platform;
  return platform === "bandcamp" ||
    platform === "soundcloud" ||
    platform === "youtube"
    ? platform
    : null;
}
