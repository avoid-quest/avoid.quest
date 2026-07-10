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
  | "pending-device"
  | "pending-external"
  | "pending-file";

export function resolveDeckPanelContentKind(
  hasRadio: boolean,
  pendingPlatform?: Platform
): DeckPanelContentKind {
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
  if (!isStreamingMetadata(metadata)) {
    return false;
  }
  const hasTracks = Boolean(metadata.tracks && metadata.tracks.length > 0);
  if (!hasTracks) {
    return false;
  }

  if (metadata.platform === "bandcamp") {
    return (
      metadata.itemType === "album" ||
      metadata.itemType === "artist" ||
      metadata.itemType === "collection"
    );
  }
  if (metadata.platform === "soundcloud") {
    return metadata.itemType === "playlist" || metadata.itemType === "user";
  }
  if (metadata.platform === "youtube") {
    return metadata.itemType === "playlist";
  }
  if (metadata.platform === "static-audio") {
    return metadata.itemType === "playlist";
  }
  return false;
}
