import type { SoundCloudItemType } from "./types.js";

const SOUNDCLOUD_PATTERN = /soundcloud\.com/i;
const SOUNDCLOUD_TRACK_PATTERN = /soundcloud\.com\/[^/]+\/[^/]+/i;
const SOUNDCLOUD_PLAYLIST_PATTERN = /soundcloud\.com\/[^/]+\/sets\/[^/]+/i;

export function isSoundCloudUrl(url: string): boolean {
  return Boolean(url) && SOUNDCLOUD_PATTERN.test(url);
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
