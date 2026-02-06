import type { SoundCloudItemType } from "./types.js";

const SOUNDCLOUD_PATTERN = /soundcloud\.com/i;
const SOUNDCLOUD_SHORT_LINK = /on\.soundcloud\.com\/[a-zA-Z0-9]+/i;
const SOUNDCLOUD_MOBILE = /m\.soundcloud\.com/i;
const SOUNDCLOUD_TRACK_PATTERN = /soundcloud\.com\/[^/]+\/[^/]+/i;
const SOUNDCLOUD_PLAYLIST_PATTERN = /soundcloud\.com\/[^/]+\/sets\/[^/]+/i;

export function isSoundCloudUrl(url: string): boolean {
  return (
    Boolean(url) &&
    (SOUNDCLOUD_PATTERN.test(url) || SOUNDCLOUD_SHORT_LINK.test(url))
  );
}

/**
 * Check if URL is a SoundCloud short link that needs resolution
 */
export function needsResolution(url: string): boolean {
  return SOUNDCLOUD_SHORT_LINK.test(url);
}

/**
 * Normalize SoundCloud URL (converts mobile URLs to desktop)
 */
export function normalizeSoundCloudUrl(url: string): string {
  return url.replace(SOUNDCLOUD_MOBILE, "soundcloud.com");
}

export function detectSoundCloudItemType(url: string): SoundCloudItemType {
  if (SOUNDCLOUD_PLAYLIST_PATTERN.test(url)) {
    return "playlist";
  }
  if (SOUNDCLOUD_TRACK_PATTERN.test(url)) {
    return "track";
  }
  return "user";
}
