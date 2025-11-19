import type { Radio } from "@/lib/types";
import type { PlatformMetadata } from "./types";

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
