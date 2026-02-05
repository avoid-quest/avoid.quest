import { isBandcampUrl } from "@avoid.quest/bandcamp";
import { isSoundCloudUrl } from "@avoid.quest/soundcloud";
import { isYouTubeUrl } from "@avoid.quest/youtube";
import { isStaticAudioUrl } from "@/lib/audio/remote-url";
import type { Platform } from "@/lib/platform-types";

export { detectBandcampItemType } from "@avoid.quest/bandcamp";
export { detectSoundCloudItemType } from "@avoid.quest/soundcloud";
export { detectYouTubeItemType } from "@avoid.quest/youtube";
export {
  isAudioUrl,
  isPlaylistUrl,
  isStaticAudioUrl,
} from "@/lib/audio/remote-url";

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

  if (isYouTubeUrl(url)) {
    return "youtube";
  }

  // Check for direct audio file URLs (mp3, wav, m3u, etc.)
  if (isStaticAudioUrl(url)) {
    return "static-audio";
  }

  return null;
}
