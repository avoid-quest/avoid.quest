import type { SoundCloudItemType } from "@avoid.quest/radio-shared";

const SOUNDCLOUD_PATTERN = /soundcloud\.com/i;
const SOUNDCLOUD_TRACK_PATTERN = /soundcloud\.com\/[^/]+\/[^/]+/i;
const SOUNDCLOUD_PLAYLIST_PATTERN = /soundcloud\.com\/[^/]+\/sets\/[^/]+/i;

export function isSoundCloudUrl(url: string): boolean {
  if (!url || typeof url !== "string") {
    return false;
  }
  return SOUNDCLOUD_PATTERN.test(url);
}

/**
 * Detects the SoundCloud item type from a URL string.
 * @param url - The URL to detect the item type from
 * @returns The detected item type
 */
export function detectSoundCloudItemType(url: string): SoundCloudItemType {
  if (SOUNDCLOUD_PLAYLIST_PATTERN.test(url)) {
    return "playlist";
  }
  if (SOUNDCLOUD_TRACK_PATTERN.test(url)) {
    return "track";
  }
  return "user";
}
