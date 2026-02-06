import { detectPlatformFromUrl as detectExternalPlatform } from "@avoid.quest/platforms";
import { isStaticAudioUrl } from "@/lib/audio/remote-url";
import type { Platform } from "@/lib/platform-types";

export {
  detectBandcampItemType,
  detectSoundCloudItemType,
  detectYouTubeItemType,
} from "@avoid.quest/platforms";
export {
  isAudioUrl,
  isPlaylistUrl,
  isStaticAudioUrl,
} from "@/lib/audio/remote-url";

/**
 * Detects the platform from a URL string.
 * Extends the package-level detection with static-audio support.
 */
export function detectPlatformFromUrl(url: string): Platform | null {
  // Check external platforms first
  const external = detectExternalPlatform(url);
  if (external) {
    return external;
  }

  // Check for direct audio file URLs (mp3, wav, m3u, etc.)
  if (url && isStaticAudioUrl(url)) {
    return "static-audio";
  }

  return null;
}
