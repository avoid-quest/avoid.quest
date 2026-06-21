import type {
  BandcampMetadata,
  PlatformMetadata,
  SoundCloudMetadata,
  YouTubeMetadata,
} from "@/lib/platform-types";

export function isStreamingMetadata(
  metadata?: PlatformMetadata
): metadata is BandcampMetadata | SoundCloudMetadata | YouTubeMetadata {
  return (
    metadata !== undefined &&
    metadata.platform !== "device-input" &&
    metadata.platform !== "local-file"
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
  return false;
}
