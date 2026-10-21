import { detectPlayablePlatformFromUrl } from "@avoid.quest/platforms/detect";
import { detectBrowserAudioSource } from "@/lib/browser-audio-links";
import type { Platform } from "@/lib/platform-types";

/**
 * Detects the platform from a URL string.
 */
export function detectPlatformFromUrl(url: string): Platform | null {
  return detectBrowserAudioSource(url) ?? detectPlayablePlatformFromUrl(url);
}
