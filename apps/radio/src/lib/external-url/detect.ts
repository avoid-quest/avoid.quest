import { isBandcampUrl } from "@avoid.quest/bandcamp";
import type { Platform } from "@avoid.quest/radio-shared";
import { isSoundCloudUrl } from "@avoid.quest/soundcloud";

export { detectBandcampItemType } from "@avoid.quest/bandcamp";
export { detectSoundCloudItemType } from "@avoid.quest/soundcloud";

/**
 * Detects the platform from a URL string.
 * @param url - The URL to detect the platform from
 * @returns The detected platform or null if the URL doesn't match any supported platform
 */
export function detectPlatformFromUrl(url: string): Platform | null {
  if (!url || typeof url !== "string") {
    return null;
  }

  if (isBandcampUrl(url)) {
    return "bandcamp";
  }

  if (isSoundCloudUrl(url)) {
    return "soundcloud";
  }

  return null;
}
