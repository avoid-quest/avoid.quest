import type { BandcampItemType } from "@avoid.quest/radio-shared";

const BANDCAMP_PATTERN = /bandcamp\.com/i;
const BANDCAMP_ALBUM_PATTERN = /bandcamp\.com\/album\//i;
const BANDCAMP_TRACK_PATTERN = /bandcamp\.com\/track\//i;
const BANDCAMP_LABEL_PATTERN = /bandcamp\.com\/label\//i;

export function isBandcampUrl(url: string): boolean {
  if (!url) {
    return false;
  }
  return BANDCAMP_PATTERN.test(url);
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
  if (BANDCAMP_LABEL_PATTERN.test(url)) {
    return "label";
  }
  return "artist";
}
