import type { BandcampItemType, Platform, SoundCloudItemType } from "./types";

const BANDCAMP_PATTERN = /bandcamp\.com/i;
const SOUNDCLOUD_PATTERN = /soundcloud\.com/i;
const BANDCAMP_ALBUM_PATTERN = /bandcamp\.com\/album\//i;
const BANDCAMP_TRACK_PATTERN = /bandcamp\.com\/track\//i;
const SOUNDCLOUD_TRACK_PATTERN = /soundcloud\.com\/[^/]+\/[^/]+/i;
const SOUNDCLOUD_PLAYLIST_PATTERN = /soundcloud\.com\/[^/]+\/sets\/[^/]+/i;

/**
 * Detects the platform from a URL string.
 * @param url - The URL to detect the platform from
 * @returns The detected platform or null if the URL doesn't match any supported platform
 */
export function detectPlatformFromUrl(url: string): Platform | null {
  if (!url || typeof url !== "string") {
    return null;
  }

  if (BANDCAMP_PATTERN.test(url)) {
    return "bandcamp";
  }

  if (SOUNDCLOUD_PATTERN.test(url)) {
    return "soundcloud";
  }

  return null;
}

/**
 * Detects the Bandcamp item type from a URL string.
 * @param url - The URL to detect the item type from
 * @returns The detected item type
 */
export function detectBandcampItemType(url: string): BandcampItemType {
  if (BANDCAMP_ALBUM_PATTERN.test(url)) {
    return "album";
  }
  if (BANDCAMP_TRACK_PATTERN.test(url)) {
    return "track";
  }
  return "artist";
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
