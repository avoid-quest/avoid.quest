import type { Radio } from "@/lib/types";
import type { PlatformMetadata } from "./types";

function generateName(metadata: PlatformMetadata): string {
  if (metadata.artist && metadata.name) {
    return `${metadata.artist} - ${metadata.name}`;
  }
  if (metadata.artist) {
    return metadata.artist;
  }
  return metadata.name || "Unknown";
}

function getBandcampDescription(
  metadata: PlatformMetadata & { platform: "bandcamp" }
): string | undefined {
  if (metadata.itemType === "album") {
    return metadata.artist ? `Album by ${metadata.artist}` : "Bandcamp Album";
  }
  if (metadata.itemType === "track") {
    return metadata.albumName
      ? `Track from ${metadata.albumName}`
      : "Bandcamp Track";
  }
  return;
}

function getSoundCloudDescription(
  metadata: PlatformMetadata & { platform: "soundcloud" }
): string | undefined {
  if (metadata.itemType === "track") {
    return metadata.artist ? `Track by ${metadata.artist}` : "SoundCloud Track";
  }
  if (metadata.itemType === "playlist") {
    return "SoundCloud Playlist";
  }
  return;
}

function generateDescription(metadata: PlatformMetadata): string | undefined {
  if (metadata.platform === "bandcamp") {
    return getBandcampDescription(metadata);
  }
  if (metadata.platform === "soundcloud") {
    return getSoundCloudDescription(metadata);
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
  const timestamp = Date.now();

  return {
    id: timestamp,
    name: generateName(metadata),
    streamUrl,
    logoUrl: getLogoUrl(metadata),
    description: generateDescription(metadata),
    websiteUrl: metadata.url,
    platformMetadata: metadata,
    enabled: true,
  };
}
