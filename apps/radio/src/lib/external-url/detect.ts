import { detectPlayablePlatformFromUrl } from "@avoid.quest/platforms";
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
 */
export function detectPlatformFromUrl(url: string): Platform | null {
  return detectPlayablePlatformFromUrl(url);
}
