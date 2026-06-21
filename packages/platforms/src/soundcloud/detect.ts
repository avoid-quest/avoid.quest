import { parseHttpUrl } from "../url-policy/hostname.js";
import type { SoundCloudItemType } from "./types.js";
import {
  isSoundCloudMobileHostname,
  isSoundCloudShortLinkHostname,
  SOUNDCLOUD_HOST,
} from "./url-policy.js";

export { isSoundCloudUrl } from "./url-policy.js";

const SOUNDCLOUD_SHORT_LINK_PATH = /^\/[a-zA-Z0-9]+\/?$/;
const SOUNDCLOUD_TRACK_PATTERN = /soundcloud\.com\/[^/]+\/[^/]+/i;
const SOUNDCLOUD_PLAYLIST_PATTERN = /soundcloud\.com\/[^/]+\/sets\/[^/]+/i;

/**
 * Check if URL is a SoundCloud short link that needs resolution
 */
export function needsResolution(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return false;
  }

  return (
    isSoundCloudShortLinkHostname(parsed.hostname) &&
    SOUNDCLOUD_SHORT_LINK_PATH.test(parsed.pathname)
  );
}

/**
 * Normalize SoundCloud URL (converts mobile URLs to desktop)
 */
export function normalizeSoundCloudUrl(url: string): string {
  const parsed = parseHttpUrl(url);
  if (!(parsed && isSoundCloudMobileHostname(parsed.hostname))) {
    return url;
  }

  parsed.hostname = SOUNDCLOUD_HOST;
  return parsed.toString();
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
